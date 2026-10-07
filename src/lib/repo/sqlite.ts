// SQLite Repo 实现（tauri-plugin-sql，spec: app-persistence 应用状态保存范围）。
// 路径：绝对路径 {appDataDir}/argus.db（显式钉死数据目录，避免插件对相对路径的
// 基目录歧义——tasks 1.1）。WAL 模式提升崩溃安全。JSON 列在此层序列化/反序列化。

import type {
  BlockRow,
  CategoryGroup,
  FindingLinkRow,
  DocumentRow,
  FindingRow,
  ProjectRow,
  PromptVersionRow,
  PromptSource,
  Repo,
  ReportRow,
  RoundRow,
  RoundSnapshot,
  RunRow,
  StoredCategory,
  StoredModel,
} from "./types";
import { ReadOnlyStorageError } from "./types";
import { APP_SCHEMA_VERSION, applyMigrations, type MigrationDb } from "./migrations/index";

interface ModelSqlRow {
  id: string;
  provider: string;
  model: string;
  display_name: string | null;
  base_url: string | null;
  keyring_ref: string | null;
  is_default: number;
  extra_json: string | null;
}

interface CategorySqlRow {
  id: string;
  name: string;
  en: string | null;
  description: string | null;
  color: string | null;
  prompt: string;
  enabled: number;
  default_selected: number;
  sort_order: number;
  current_version: number;
  created_at: string;
  group_id: string | null;
}

interface VersionSqlRow {
  category_id: string;
  version: number;
  source: string;
  prompt: string;
  skill_meta: string | null;
  created_at: string;
}

const b2i = (v: boolean | undefined): number => (v ? 1 : 0);

function modelToRow(m: StoredModel): unknown[] {
  const { temperature, maxTokens, contextWindow } = m;
  const extra =
    temperature !== undefined || maxTokens !== undefined || contextWindow !== undefined
      ? JSON.stringify({ ...(temperature !== undefined ? { temperature } : {}), ...(maxTokens !== undefined ? { maxTokens } : {}), ...(contextWindow !== undefined ? { contextWindow } : {}) })
      : null;
  return [m.id, m.provider, m.model, m.displayName ?? null, m.baseUrl ?? null, m.keyringRef ?? null, b2i(m.isDefault), extra];
}

function modelFromRow(r: ModelSqlRow): StoredModel {
  const extra = r.extra_json ? (JSON.parse(r.extra_json) as Record<string, unknown>) : {};
  const m: StoredModel = {
    id: r.id,
    provider: r.provider,
    model: r.model,
    isDefault: r.is_default === 1,
  };
  if (r.display_name != null) m.displayName = r.display_name;
  if (r.base_url != null) m.baseUrl = r.base_url;
  if (r.keyring_ref != null) m.keyringRef = r.keyring_ref;
  if (typeof extra.temperature === "number") m.temperature = extra.temperature;
  if (typeof extra.maxTokens === "number") m.maxTokens = extra.maxTokens;
  if (typeof extra.contextWindow === "number") m.contextWindow = extra.contextWindow;
  return m;
}

/** plugin-sql Database 的最小接口（构造注入点：测试用 node:sqlite 提供同形适配器）。 */
export interface SqliteDatabase {
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  select<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
}

async function defaultConnect(): Promise<SqliteDatabase> {
  const [{ appDataDir, join }, { default: DatabaseCtor }] = await Promise.all([
    import("@tauri-apps/api/path"),
    import("@tauri-apps/plugin-sql"),
  ]);
  const dir = await appDataDir();
  const path = await join(dir, "argus.db");
  // 显式绝对路径钉死数据目录（tasks 1.1：避免插件对相对路径基目录的歧义）
  return DatabaseCtor.load(`sqlite:${path}`) as Promise<SqliteDatabase>;
}

export class SqliteRepo implements Repo {
  readonly kind = "sqlite" as const;
  private _readOnly = false;
  private db: SqliteDatabase | null = null;
  private opening: Promise<void> | null = null;

  constructor(private readonly connect: () => Promise<SqliteDatabase> = defaultConnect) {}

  get readOnly(): boolean {
    return this._readOnly;
  }

  private async handle(): Promise<SqliteDatabase> {
    if (!this.db) throw new Error("sqlite repo not opened");
    return this.db;
  }

  private assertWritable(): void {
    if (this._readOnly) throw new ReadOnlyStorageError();
  }

  async open(): Promise<void> {
    if (this.db) return;
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const db = await this.connect();
      this.db = db;

      const adapter: MigrationDb = {
        exec: async (sql, params) => {
          await db.execute(sql, params ?? []);
        },
        select: async <T>(sql: string, params?: unknown[]) => {
          return (await db.select<T[]>(sql, params ?? [])) as T[];
        },
      };

      await adapter.exec("PRAGMA journal_mode=WAL");
      await adapter.exec("PRAGMA foreign_keys=ON");

      const version = await applyMigrations(adapter);
      if (version > APP_SCHEMA_VERSION) {
        // 降级保护（spec: 存储迁移与版本兼容）：库比应用新 → 只读
        this._readOnly = true;
      }
    })();
    try {
      await this.opening;
    } finally {
      this.opening = null;
    }
  }

  private async exec(sql: string, params: unknown[] = []): Promise<void> {
    this.assertWritable();
    await (await this.handle()).execute(sql, params);
  }

  private async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await (await this.handle()).select<T>(sql, params)) as T[];
  }

  // ---- 设置区 ----
  async listModels(): Promise<StoredModel[]> {
    const rows = await this.all<ModelSqlRow>("SELECT * FROM model_configs ORDER BY rowid");
    return rows.map(modelFromRow);
  }

  async putModel(m: StoredModel): Promise<void> {
    await this.exec(
      `INSERT INTO model_configs (id, provider, model, display_name, base_url, keyring_ref, is_default, extra_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, model=excluded.model,
         display_name=excluded.display_name, base_url=excluded.base_url, keyring_ref=excluded.keyring_ref,
         is_default=excluded.is_default, extra_json=excluded.extra_json`,
      modelToRow(m),
    );
  }

  async deleteModel(id: string): Promise<void> {
    await this.exec("DELETE FROM model_configs WHERE id = ?", [id]);
  }

  async listCategories(): Promise<StoredCategory[]> {
    const rows = await this.all<CategorySqlRow>("SELECT * FROM categories ORDER BY sort_order, rowid");
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      ...(r.en != null ? { en: r.en } : {}),
      ...(r.description != null ? { description: r.description } : {}),
      ...(r.color != null ? { color: r.color } : {}),
      prompt: r.prompt,
      enabled: r.enabled === 1,
      defaultSelected: r.default_selected === 1,
      order: r.sort_order,
      currentVersion: r.current_version,
      ...(r.group_id != null ? { groupId: r.group_id } : {}),
    }));
  }

  async putCategory(c: StoredCategory): Promise<void> {
    await this.exec(
      `INSERT INTO categories (id, name, en, description, color, prompt, enabled, default_selected, sort_order, current_version, created_at, group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, en=excluded.en, description=excluded.description,
         color=excluded.color, prompt=excluded.prompt, enabled=excluded.enabled,
         default_selected=excluded.default_selected, sort_order=excluded.sort_order,
         current_version=excluded.current_version, group_id=excluded.group_id`,
      [c.id, c.name, c.en ?? null, c.description ?? null, c.color ?? null, c.prompt, b2i(c.enabled), b2i(c.defaultSelected), c.order, c.currentVersion, new Date().toISOString(), c.groupId ?? null],
    );
    // 首次落库即种 v1（builtin）——与内存实现/首迁同一路径
    await this.exec(
      `INSERT OR IGNORE INTO category_prompt_versions (category_id, version, source, prompt, created_at)
       VALUES (?, 1, 'builtin', ?, ?)`,
      [c.id, c.prompt, new Date().toISOString()],
    );
  }

  async deleteCategory(id: string): Promise<void> {
    await this.exec("DELETE FROM categories WHERE id = ?", [id]);
  }

  // ---- 分组区（spec: settings 类别分组管理）----
  async listGroups(): Promise<CategoryGroup[]> {
    const rows = await this.all<{ id: string; name: string; sort_order: number }>(
      "SELECT id, name, sort_order FROM category_groups ORDER BY sort_order, rowid",
    );
    return rows.map((r) => ({ id: r.id, name: r.name, order: r.sort_order }));
  }

  async insertGroup(g: CategoryGroup): Promise<void> {
    await this.exec(
      "INSERT OR IGNORE INTO category_groups (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)",
      [g.id, g.name, g.order, new Date().toISOString()],
    );
  }

  async renameGroup(id: string, name: string): Promise<void> {
    await this.exec("UPDATE category_groups SET name = ? WHERE id = ?", [name, id]);
  }

  async moveGroup(id: string, dir: -1 | 1): Promise<void> {
    const rows = await this.all<{ id: string; sort_order: number }>(
      "SELECT id, sort_order FROM category_groups ORDER BY sort_order, rowid",
    );
    const idx = rows.findIndex((r) => r.id === id);
    const swapWith = idx + dir;
    if (idx < 0 || swapWith < 0 || swapWith >= rows.length) return;
    const a = rows[idx];
    const b = rows[swapWith];
    await this.exec("UPDATE category_groups SET sort_order = ? WHERE id = ?", [b.sort_order, a.id]);
    await this.exec("UPDATE category_groups SET sort_order = ? WHERE id = ?", [a.sort_order, b.id]);
  }

  async deleteGroup(id: string): Promise<void> {
    // 先解除归属再删行（FK NO ACTION；两步均幂等，崩溃重放安全）
    await this.exec("UPDATE categories SET group_id = NULL WHERE group_id = ?", [id]);
    await this.exec("DELETE FROM category_groups WHERE id = ?", [id]);
  }

  async assignCategoryGroup(categoryId: string, groupId: string | null): Promise<void> {
    await this.exec("UPDATE categories SET group_id = ? WHERE id = ?", [groupId, categoryId]);
  }

  async listPromptVersions(categoryId: string): Promise<PromptVersionRow[]> {
    const rows = await this.all<VersionSqlRow>(
      "SELECT category_id, version, source, prompt, skill_meta, created_at FROM category_prompt_versions WHERE category_id = ? ORDER BY version",
      [categoryId],
    );
    return rows.map((r) => ({
      categoryId: r.category_id,
      version: r.version,
      source: r.source as PromptSource,
      prompt: r.prompt,
      ...(r.skill_meta != null ? { skillMeta: JSON.parse(r.skill_meta) } : {}),
      createdAt: r.created_at,
    }));
  }

  async getPromptVersionText(categoryId: string, version: number): Promise<string | null> {
    const rows = await this.all<{ prompt: string }>(
      "SELECT prompt FROM category_prompt_versions WHERE category_id = ? AND version = ?",
      [categoryId, version],
    );
    return rows[0]?.prompt ?? null;
  }

  async appendPromptVersion(categoryId: string, source: PromptSource, prompt: string, skillMeta?: unknown): Promise<number> {
    const nextRow = await this.all<{ nv: number | null }>(
      "SELECT MAX(version) + 1 AS nv FROM category_prompt_versions WHERE category_id = ?",
      [categoryId],
    );
    const next = nextRow[0]?.nv ?? 1;
    await this.exec(
      `INSERT INTO category_prompt_versions (category_id, version, source, prompt, skill_meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [categoryId, next, source, prompt, skillMeta !== undefined ? JSON.stringify(skillMeta) : null, new Date().toISOString()],
    );
    await this.exec("UPDATE categories SET current_version = ? WHERE id = ?", [next, categoryId]);
    return next;
  }

  async getPref<T>(key: string): Promise<T | undefined> {
    const rows = await this.all<{ value: string }>("SELECT value FROM app_prefs WHERE key = ?", [key]);
    if (!rows[0]) return undefined;
    return JSON.parse(rows[0].value) as T;
  }

  async setPref(key: string, value: unknown): Promise<void> {
    await this.exec(
      `INSERT INTO app_prefs (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, JSON.stringify(value)],
    );
  }

  async deletePref(key: string): Promise<void> {
    await this.exec("DELETE FROM app_prefs WHERE key = ?", [key]);
  }

  // ---- 审阅区（写入幂等：OR IGNORE，供首迁安全重放）----
  async insertProject(p: ProjectRow): Promise<void> {
    await this.exec(
      "INSERT OR IGNORE INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      [p.id, p.name, p.createdAt, p.updatedAt],
    );
  }

  async listProjects(): Promise<ProjectRow[]> {
    return this.all<ProjectRow>("SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM projects ORDER BY created_at, rowid");
  }

  async renameProject(id: string, name: string): Promise<void> {
    await this.exec("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?", [name, new Date().toISOString(), id]);
  }

  async deleteProject(id: string): Promise<void> {
    await this.exec("DELETE FROM projects WHERE id = ?", [id]); // rounds 以下经 FK ON DELETE CASCADE
  }

  async listRounds(projectId: string): Promise<RoundRow[]> {
    const rows = await this.all<{
      id: string; project_id: string; number: number; status: string;
      category_snapshot: string; model_snapshot: string; config_changed: number; created_at: string;
    }>("SELECT * FROM rounds WHERE project_id = ? ORDER BY number", [projectId]);
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      number: r.number,
      status: r.status as RoundRow["status"],
      categorySnapshot: JSON.parse(r.category_snapshot),
      modelSnapshot: JSON.parse(r.model_snapshot),
      ...(r.config_changed ? { configChanged: true } : {}),
      createdAt: r.created_at,
    }));
  }

  async updateRoundStatus(roundId: string, status: RoundRow["status"]): Promise<void> {
    await this.exec("UPDATE rounds SET status = ? WHERE id = ?", [status, roundId]);
  }

  async deleteRound(roundId: string): Promise<void> {
    await this.exec("DELETE FROM rounds WHERE id = ?", [roundId]); // 级联经 FK
  }

  async insertRound(r: RoundRow): Promise<void> {
    await this.exec(
      `INSERT OR IGNORE INTO rounds (id, project_id, number, status, category_snapshot, model_snapshot, config_changed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.projectId, r.number, r.status, JSON.stringify(r.categorySnapshot), JSON.stringify(r.modelSnapshot), b2i(r.configChanged), r.createdAt],
    );
  }

  async insertDocument(d: DocumentRow): Promise<void> {
    await this.exec(
      "INSERT OR IGNORE INTO documents (id, round_id, text, source_meta, created_at) VALUES (?, ?, ?, ?, ?)",
      [d.id, d.roundId, d.text, d.sourceMeta !== undefined ? JSON.stringify(d.sourceMeta) : null, d.createdAt],
    );
  }

  async insertBlocks(documentId: string, blocks: BlockRow[]): Promise<void> {
    for (const b of blocks) {
      await this.exec(
        `INSERT OR IGNORE INTO document_blocks (document_id, seq, type, raw_text, plain_text, line)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [documentId, b.seq, b.type, b.rawText, b.plainText, b.line],
      );
    }
  }

  async upsertRun(r: RunRow): Promise<void> {
    await this.exec(
      `INSERT INTO runs (id, round_id, category_id, category_version, model_config_id, status, error, degraded, retries, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status, error=excluded.error, degraded=excluded.degraded,
         retries=excluded.retries, started_at=excluded.started_at, completed_at=excluded.completed_at`,
      [r.id, r.roundId, r.categoryId, r.categoryVersion, r.modelConfigId ?? null, r.status, r.error ?? null, r.degraded === undefined ? null : b2i(r.degraded), r.retries ?? null, r.startedAt ?? null, r.completedAt ?? null],
    );
  }

  async insertFindings(rows: FindingRow[]): Promise<void> {
    for (const f of rows) {
      await this.exec(
        `INSERT OR IGNORE INTO findings (id, round_id, run_id, category_id, severity, title, quote,
           line_hint, content_hash, line, block_seq, start_offset, end_offset,
           problem, reason, suggestion, anchor_status, anchors_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [f.id, f.roundId, f.runId, f.categoryId, f.severity, f.title, f.quote,
          f.lineHint ?? null, f.contentHash ?? null, f.line ?? null, f.blockSeq ?? null,
          f.startOffset ?? null, f.endOffset ?? null,
          f.problem, f.reason, f.suggestion, f.anchorStatus,
          f.anchors && f.anchors.length > 0 ? JSON.stringify(f.anchors) : null],
      );
    }
  }

  async deleteCategoryFindings(roundId: string, categoryId: string): Promise<void> {
    await this.exec("DELETE FROM findings WHERE round_id = ? AND category_id = ?", [roundId, categoryId]);
  }

  async putReport(r: ReportRow): Promise<void> {
    await this.exec(
      `INSERT INTO reports (round_id, summary, priority_finding_ids, category_summaries, failed_category_ids, degraded, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(round_id) DO UPDATE SET summary=excluded.summary,
         priority_finding_ids=excluded.priority_finding_ids, category_summaries=excluded.category_summaries,
         failed_category_ids=excluded.failed_category_ids, degraded=excluded.degraded, generated_at=excluded.generated_at`,
      [r.roundId, r.summary, JSON.stringify(r.priorityFindingIds), JSON.stringify(r.categorySummaries), JSON.stringify(r.failedCategoryIds), r.degraded === undefined ? null : b2i(r.degraded), r.generatedAt],
    );
  }

  async loadRound(roundId: string): Promise<RoundSnapshot | null> {
    const roundRows = await this.all<{
      id: string; project_id: string; number: number; status: string;
      category_snapshot: string; model_snapshot: string; config_changed: number; created_at: string;
    }>("SELECT * FROM rounds WHERE id = ?", [roundId]);
    const rr = roundRows[0];
    if (!rr) return null;
    const docRows = await this.all<{ id: string; text: string; source_meta: string | null; created_at: string }>(
      "SELECT id, text, source_meta, created_at FROM documents WHERE round_id = ?",
      [roundId],
    );
    const dr = docRows[0];
    if (!dr) return null;
    const blockRows = await this.all<{ seq: number; type: string; raw_text: string; plain_text: string; line: number }>(
      "SELECT seq, type, raw_text, plain_text, line FROM document_blocks WHERE document_id = ? ORDER BY seq",
      [dr.id],
    );
    const runRows = await this.all<Record<string, unknown>>(
      "SELECT id, round_id, category_id, category_version, model_config_id, status, error, degraded, retries, started_at, completed_at FROM runs WHERE round_id = ?",
      [roundId],
    );
    const findingRows = await this.all<Record<string, unknown>>(
      "SELECT id, round_id, run_id, category_id, severity, title, quote, line_hint, content_hash, line, block_seq, start_offset, end_offset, problem, reason, suggestion, anchor_status, anchors_json FROM findings WHERE round_id = ?",
      [roundId],
    );
    const reportRows = await this.all<{ summary: string; priority_finding_ids: string; category_summaries: string; failed_category_ids: string; degraded: number | null; generated_at: string }>(
      "SELECT summary, priority_finding_ids, category_summaries, failed_category_ids, degraded, generated_at FROM reports WHERE round_id = ?",
      [roundId],
    );
    const nullable = <T,>(v: unknown): T | undefined => (v === null ? undefined : (v as T));
    return {
      round: {
        id: rr.id,
        projectId: rr.project_id,
        number: rr.number,
        status: rr.status as RoundRow["status"],
        categorySnapshot: JSON.parse(rr.category_snapshot),
        modelSnapshot: JSON.parse(rr.model_snapshot),
        ...(rr.config_changed ? { configChanged: true } : {}),
        createdAt: rr.created_at,
      },
      document: {
        id: dr.id,
        roundId,
        text: dr.text,
        ...(dr.source_meta != null ? { sourceMeta: JSON.parse(dr.source_meta) } : {}),
        createdAt: dr.created_at,
      },
      blocks: blockRows.map((b) => ({ seq: b.seq, type: b.type as BlockRow["type"], rawText: b.raw_text, plainText: b.plain_text, line: b.line })),
      runs: runRows.map((r) => ({
        id: r.id as string,
        roundId: r.round_id as string,
        categoryId: r.category_id as string,
        categoryVersion: r.category_version as number,
        modelConfigId: nullable<string>(r.model_config_id),
        status: r.status as RunRow["status"],
        error: nullable<string>(r.error),
        degraded: r.degraded === null ? undefined : r.degraded === 1,
        retries: nullable<number>(r.retries),
        startedAt: nullable<string>(r.started_at),
        completedAt: nullable<string>(r.completed_at),
      })),
      findings: findingRows.map((f) => ({
        id: f.id as string,
        roundId: f.round_id as string,
        runId: f.run_id as string,
        categoryId: f.category_id as string,
        severity: f.severity as FindingRow["severity"],
        title: f.title as string,
        quote: f.quote as string,
        lineHint: nullable<number>(f.line_hint),
        contentHash: nullable<string>(f.content_hash),
        line: nullable<number>(f.line),
        blockSeq: nullable<number>(f.block_seq),
        startOffset: nullable<number>(f.start_offset),
        endOffset: nullable<number>(f.end_offset),
        problem: f.problem as string,
        reason: f.reason as string,
        suggestion: f.suggestion as string,
        anchorStatus: f.anchor_status as FindingRow["anchorStatus"],
        ...(f.anchors_json != null ? { anchors: JSON.parse(f.anchors_json as string) as FindingRow["anchors"] } : {}),
      })),
      report: reportRows[0]
        ? {
            roundId,
            summary: reportRows[0].summary,
            priorityFindingIds: JSON.parse(reportRows[0].priority_finding_ids),
            categorySummaries: JSON.parse(reportRows[0].category_summaries),
            failedCategoryIds: JSON.parse(reportRows[0].failed_category_ids),
            ...(reportRows[0].degraded === null ? {} : { degraded: reportRows[0].degraded === 1 }),
            generatedAt: reportRows[0].generated_at,
          }
        : null,
    };
  }

  async insertLinks(rows: FindingLinkRow[]): Promise<void> {
    for (const l of rows) {
      await this.exec(
        `INSERT INTO finding_links (prev_finding_id, curr_round_id, link_type, curr_finding_id, confidence, computed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [l.prevFindingId, l.currRoundId, l.linkType, l.currFindingId ?? null, l.confidence ?? null, l.computedAt],
      );
    }
  }

  async deleteLinksByRound(roundId: string): Promise<void> {
    await this.exec("DELETE FROM finding_links WHERE curr_round_id = ?", [roundId]);
  }

  async listLinksByRound(roundId: string): Promise<FindingLinkRow[]> {
    const rows = await this.all<{ prev_finding_id: string; curr_round_id: string; link_type: string; curr_finding_id: string | null; confidence: number | null }>(
      "SELECT prev_finding_id, curr_round_id, link_type, curr_finding_id, confidence FROM finding_links WHERE curr_round_id = ?",
      [roundId],
    );
    return rows.map((r) => ({
      prevFindingId: r.prev_finding_id,
      currRoundId: r.curr_round_id,
      linkType: r.link_type as FindingLinkRow["linkType"],
      ...(r.curr_finding_id != null ? { currFindingId: r.curr_finding_id } : {}),
      ...(r.confidence != null ? { confidence: r.confidence } : {}),
      computedAt: "",
    }));
  }
}
