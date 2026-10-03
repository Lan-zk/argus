// 开发联调执行器（仅 debug 构建生效）：读取应用数据目录的 spike-request.json，
// 在真实 WebView + 真实 tauri http fetch 通道 + 真实产品代码路径上执行：
//  - phase "run"：单次调用验证（tasks 1.3）→ 全链路审阅（tasks 7.2：并行/定位/去重/报告/重跑单类）→ 写 spike-result.json
//  - phase "verify_restore"：重启后由 App.vue 恢复流程调用，记录恢复状态 → 写 spike-result-restore.json
// release 构建（无 dev_spike command）自动跳过。
import { invoke } from "@tauri-apps/api/core";
import type { ModelConfig } from "../domain/types";
import { SAMPLE_DOC } from "./sample";
import { testConnection } from "../ai/test-connection";
import { callFindings } from "../ai/call";
import { assemblePrompt } from "../domain/prompts";
import { useSettingsStore } from "../stores/settings";
import { useSessionStore } from "../stores/session";

interface SpikeRequest {
  phase: "run" | "verify_restore";
  baseUrl: string;
  model: string;
  apiKey: string;
}

async function readRequest(): Promise<SpikeRequest | null> {
  try {
    const raw = await invoke<string | null>("dev_spike_read", { name: "spike-request.json" });
    return raw ? (JSON.parse(raw) as SpikeRequest) : null;
  } catch {
    return null; // release 构建 / 无请求
  }
}

async function writeResult(name: string, payload: unknown): Promise<void> {
  try {
    await invoke("dev_spike_write", { name, content: JSON.stringify(payload, null, 2) });
  } catch {
    /* release 构建忽略 */
  }
}

function spikeModelConfig(req: SpikeRequest): ModelConfig {
  return {
    id: "spike-mock",
    provider: "openai-compatible",
    model: req.model,
    apiKey: req.apiKey,
    baseUrl: req.baseUrl,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** App.vue onMounted 调用；任何异常都写入结果文件便于诊断。 */
export async function runDevSpikeIfRequested(): Promise<void> {
  const req = await readRequest();
  if (!req) return;
  if (req.phase === "run") await runPhase(req);
  else if (req.phase === "verify_restore") await verifyRestorePhase();
}

async function runPhase(req: SpikeRequest): Promise<void> {
  const settings = useSettingsStore();
  const session = useSessionStore();
  const result: Record<string, unknown> = {
    phase: "run",
    startedAt: new Date().toISOString(),
    channel: "tauri-http (globalThis.fetch 替换)",
  };
  try {
    // ---- 通道自检：原始 fetch 直连 mock /test（隔离 pi-ai 之外的问题）----
    try {
      const probe = await fetch(req.baseUrl.replace(/\/$/, "") + "/test");
      result.rawChannel = { ok: probe.ok, status: probe.status, body: await probe.text() };
    } catch (e) {
      result.rawChannel = { ok: false, error: typeof e === "object" ? JSON.stringify(e) : String(e) };
    }

    // ---- tasks 1.3：单次真实调用（经 pi-ai complete()，验证返回文本）----
    const cfg = spikeModelConfig(req);
    const test = await testConnection(cfg, req.apiKey);
    result.singleCall = test.ok
      ? { ok: true, returnedText: true, model: test.model, note: test.usage ?? "complete() 返回文本" }
      : { ok: false, error: test.error.message };

    // 结构化调用（submit_findings 工具路径）
    const prompt = assemblePrompt({
      categoryName: "逻辑",
      categoryPrompt: "你是逻辑审阅专家。检查推理跳跃。",
      documentText: SAMPLE_DOC,
    });
    const toolFindings = await callFindings(cfg, prompt.system, prompt.user, { apiKey: req.apiKey });
    result.structuredCall = { ok: true, findingsReturned: toolFindings.length };

    // ---- tasks 7.2：全链路（并行 → 定位 → 去重 → 报告）----
    const spikeId = await settings.addModel({
      provider: "openai-compatible",
      model: req.model,
      apiKey: req.apiKey,
      baseUrl: req.baseUrl,
    });
    await settings.setDefaultModel(spikeId.id);
    const sixCats = settings.enabledCategories.filter((c) => c.id !== "speech").slice(0, 6).map((c) => c.id);

    await session.startReview(SAMPLE_DOC, sixCats);
    const deadline = Date.now() + 120_000;
    while (session.status === "running" && Date.now() < deadline) await sleep(300);

    result.fullReview = {
      sessionStatus: session.status,
      runs: session.runList.map((r) => ({
        categoryId: r.categoryId,
        status: r.status,
        findings: session.findingsOf(r.categoryId).length,
        error: r.error ?? null,
      })),
      findingsTotal: session.findings.length,
      anchored: session.findings.filter((f) => f.anchorStatus === "anchored").length,
      unanchored: session.findings.filter((f) => f.anchorStatus === "unanchored").length,
      cardComplete: session.findings.every(
        (f) => f.title && f.quote && f.problem && f.reason && f.suggestion,
      ),
      report: session.report
        ? {
            present: true,
            priorityCount: session.report.priorityFindingIds.length,
            priorityTraceable: session.report.priorityFindingIds.every((id) =>
              session.findings.some((f) => f.id === id),
            ),
            categorySummaries: session.report.categorySummaries.length,
            failedCategoryIds: session.report.failedCategoryIds,
            summaryLength: session.report.summary.length,
          }
        : { present: false },
      // 筛选（与 UI 相同的交集谓词）：逻辑 + 严重
      filterLogicHigh: session.findings.filter((f) => f.categoryId === "logic" && f.severity === "high").length,
    };

    // ---- 重跑单类 ----
    const logicBefore = session.findings.filter((f) => f.categoryId === "logic").map((f) => f.id);
    const othersBefore = session.findings.filter((f) => f.categoryId !== "logic").map((f) => f.id);
    const reportAtBefore = session.report?.generatedAt;
    await session.rerunCategory("logic");
    const rerunDeadline = Date.now() + 60_000;
    while (session.status === "running" && Date.now() < rerunDeadline) await sleep(300);
    const logicAfter = session.findings.filter((f) => f.categoryId === "logic").map((f) => f.id);
    result.rerun = {
      status: session.status,
      logicReplaced: JSON.stringify(logicBefore) !== JSON.stringify(logicAfter) || logicAfter.length > 0,
      othersUntouched:
        JSON.stringify(othersBefore) ===
        JSON.stringify(session.findings.filter((f) => f.categoryId !== "logic").map((f) => f.id)),
      reportRegenerated: !!session.report && session.report.generatedAt !== reportAtBefore,
    };

    // 清理 spike 模型（保持用户设置干净；审阅结果保留供重启恢复验证）
    await settings.deleteModel(spikeId.id);
    result.ok = true;
  } catch (e) {
    result.ok = false;
    result.error = e instanceof Error ? `${e.name}: ${e.message}` : JSON.stringify(e);
  }
  result.finishedAt = new Date().toISOString();
  await writeResult("spike-result.json", result);
}

/** 重启后：记录恢复状态并验证「清除并新建」。 */
async function verifyRestorePhase(): Promise<void> {
  const session = useSessionStore();
  const settings = useSettingsStore();
  await new Promise((r) => setTimeout(r, 500)); // 等待 App.vue 恢复流程完成
  const result = {
    phase: "verify_restore",
    restoredSession: session.session?.id ?? null,
    restoredStatus: session.status,
    restoredFindings: session.findings.length,
    restoredReport: !!session.report,
    restoreBanner: session.showRestoreBanner,
    documentRestored: !!session.document,
    draftPreserved: settings.draftText.length > 0 || !!session.document,
  };
  // 「清除并新建」验证
  try {
    await session.clearAndNew();
    Object.assign(result, {
      clearedSession: session.session === null,
      clearedFindings: session.findings.length === 0,
      clearedReport: session.report === null,
    });
  } catch (e) {
    Object.assign(result, { clearError: String(e) });
  }
  await writeResult("spike-result-restore.json", result);
}
