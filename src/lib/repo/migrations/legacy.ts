// 旧版 JSON 存储（argus-store.json）→ SQLite 首迁（spec: app-persistence 存储迁移与版本兼容；tasks 1.6）。
// 幂等可重放：全部写入 OR IGNORE / 确定性 id（由旧 session 派生），崩溃后下次启动安全重放；
// 完成标记（app_prefs.legacyMigrated）最后写——此前任何失败 → 无标记 → 下次启动重试。
// 副本式备份由调用方在迁移成功后执行（Rust legacy_store_backup，copy 不移动原文件）。

import type { ModelConfig, PersistedReview, ReviewCategory, UiPrefs } from "../../../domain/types";
import { mergeLoadedSettings, sanitizeModelConfig, type RawLoadedSettings } from "../../settings-merge";
import type { BlockRow, FindingRow, Repo, RoundRow, RunRow, StoredCategory } from "../types";

/** 旧 argus-store.json 顶层形状（宽松解析：仅取认识的字段，未知字段忽略）。 */
export interface LegacyStoreJson {
  settings?: {
    models?: unknown[];
    categories?: unknown[];
    draftText?: string;
    ui?: Record<string, unknown>;
  };
  lastReview?: PersistedReview | null;
}

function toStoredCategory(c: ReviewCategory): StoredCategory {
  // 显式构造：旧格式类别恒回落「通用」（groupId 不透传，spec: settings 类别分组管理）
  return {
    id: c.id,
    name: c.name,
    ...(c.en !== undefined ? { en: c.en } : {}),
    ...(c.description !== undefined ? { description: c.description } : {}),
    ...(c.color !== undefined ? { color: c.color } : {}),
    prompt: c.prompt,
    enabled: c.enabled ?? true,
    defaultSelected: c.defaultSelected ?? false,
    order: c.order ?? 0,
    currentVersion: 1,
  };
}

/** 首迁主流程：设置区全量迁入 + lastReview 转为「导入的审阅」项目 Round 1 + 完成标记。 */
export async function migrateLegacyStore(repo: Repo, legacy: LegacyStoreJson): Promise<void> {
  const legacyModels = ((legacy.settings?.models as ModelConfig[] | undefined) ?? []).map(sanitizeModelConfig);
  const legacyCategories = ((legacy.settings?.categories as ReviewCategory[] | undefined) ?? []).map(toStoredCategory);
  const raw: RawLoadedSettings = {
    models: legacyModels,
    categories: legacyCategories,
    draftText: legacy.settings?.draftText,
    ui: legacy.settings?.ui as Partial<UiPrefs> | undefined,
  };
  const merged = mergeLoadedSettings(raw);

  // 1) 设置区（合并后的 ui 含 onboarding 老数据启发式，行为与旧 loadState 一致）
  for (const m of merged.models) await repo.putModel(m);
  for (const c of legacyCategories) await repo.putCategory(c);
  await repo.setPref("ui", merged.ui);
  await repo.setPref("draftText", merged.draftText);

  // 2) lastReview → 「导入的审阅」Round 1（确定性 id 保证重放不重复）
  const lr = legacy.lastReview;
  if (lr?.session && lr.document) {
    const pid = `proj_legacy_${lr.session.id}`;
    const rid = `round_legacy_${lr.session.id}`;
    await repo.insertProject({
      id: pid,
      name: "导入的审阅",
      createdAt: lr.session.createdAt,
      updatedAt: lr.session.createdAt,
    });
    const modelSnapshot: Record<string, string> = {};
    for (const r of lr.runs ?? []) {
      if (r.modelConfigId) modelSnapshot[r.categoryId] = r.modelConfigId;
    }
    const round: RoundRow = {
      id: rid,
      projectId: pid,
      number: 1,
      status: lr.session.status,
      categorySnapshot: lr.session.selectedCategoryIds.map((categoryId) => ({ categoryId, version: 1 })),
      modelSnapshot,
      createdAt: lr.session.createdAt,
    };
    await repo.insertRound(round);
    await repo.insertDocument({
      id: lr.document.id,
      roundId: rid,
      text: lr.document.text,
      sourceMeta: { kind: "paste" },
      createdAt: lr.document.createdAt,
    });
    const blocks: BlockRow[] = lr.document.blocks.map((b) => ({
      seq: b.order,
      type: b.type,
      rawText: b.rawText,
      plainText: b.plainText,
      line: b.line,
    }));
    await repo.insertBlocks(lr.document.id, blocks);

    const seqByBlockId = new Map(lr.document.blocks.map((b) => [b.id, b.order]));
    for (const r of lr.runs ?? []) {
      const run: RunRow = {
        id: r.id,
        roundId: rid,
        categoryId: r.categoryId,
        categoryVersion: 1,
        ...(r.modelConfigId ? { modelConfigId: r.modelConfigId } : {}),
        status: r.status,
        ...(r.error !== undefined ? { error: r.error } : {}),
        ...(r.degraded !== undefined ? { degraded: r.degraded } : {}),
        ...(r.retries !== undefined ? { retries: r.retries } : {}),
        ...(r.startedAt !== undefined ? { startedAt: r.startedAt } : {}),
        ...(r.completedAt !== undefined ? { completedAt: r.completedAt } : {}),
      };
      await repo.upsertRun(run);
    }
    const findings: FindingRow[] = (lr.findings ?? []).map((f) => {
      let runId = (lr.runs ?? []).find((r) => r.categoryId === f.categoryId)?.id;
      if (!runId) {
        // 边界：finding 无对应 run（旧数据缺损）→ 合成补位 run，保持外键完整
        runId = `run_legacy_${lr.session!.id}_${f.categoryId}`;
      }
      return {
        id: f.id,
        roundId: rid,
        runId,
        categoryId: f.categoryId,
        severity: f.severity,
        title: f.title,
        quote: f.quote,
        ...(f.lineHint !== undefined ? { lineHint: f.lineHint } : {}),
        ...(f.contentHash !== undefined ? { contentHash: f.contentHash } : {}),
        ...(f.line !== undefined ? { line: f.line } : {}),
        ...(f.blockId !== undefined && seqByBlockId.has(f.blockId) ? { blockSeq: seqByBlockId.get(f.blockId)! } : {}),
        ...(f.startOffset !== undefined ? { startOffset: f.startOffset } : {}),
        ...(f.endOffset !== undefined ? { endOffset: f.endOffset } : {}),
        problem: f.problem,
        reason: f.reason,
        suggestion: f.suggestion,
        anchorStatus: f.anchorStatus,
      };
    });
    for (const f of findings) {
      // 补位 run 需先存在（幂等）
      if (f.runId.startsWith("run_legacy_")) {
        await repo.upsertRun({
          id: f.runId,
          roundId: rid,
          categoryId: f.categoryId,
          categoryVersion: 1,
          status: "completed",
        });
      }
    }
    await repo.insertFindings(findings);
    if (lr.report) {
      await repo.putReport({
        roundId: rid,
        summary: lr.report.summary,
        priorityFindingIds: lr.report.priorityFindingIds,
        categorySummaries: lr.report.categorySummaries,
        failedCategoryIds: lr.report.failedCategoryIds,
        ...(lr.report.degraded !== undefined ? { degraded: lr.report.degraded } : {}),
        generatedAt: lr.report.generatedAt,
      });
    }
  }

  // 3) 完成标记最后写
  await repo.setPref("legacyMigrated", true);
}
