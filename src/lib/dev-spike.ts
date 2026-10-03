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
  phase: "run" | "verify_restore" | "model_config" | "diag_opencode";
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
  else if (req.phase === "model_config") await modelConfigPhase(req);
  else if (req.phase === "diag_opencode") await diagOpencodePhase(req);
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

/** 诊断：opencode 系预设的应用内调用（假 Key，预期 401 → invalid_api_key；捕获原始错误文本）。 */
async function diagOpencodePhase(req: SpikeRequest): Promise<void> {
  const result: Record<string, unknown> = { phase: "diag_opencode", startedAt: new Date().toISOString() };
  try {
    const { testConnection } = await import("../ai/test-connection");
    for (const provider of ["opencode-go", "opencode", "deepseek"] as const) {
      const { resolveModel } = await import("../ai/client");
      const { model } = await resolveModel({ id: `diag-${provider}`, provider, model: req.model } as never);
      result[`${provider}_resolved`] = { api: model.api, baseUrl: model.baseUrl };
      const res = await testConnection({ id: `diag-${provider}`, provider, model: req.model } as never, req.apiKey);
      result[provider] = res.ok
        ? { ok: true, model: res.model }
        : { ok: false, kind: res.error.kind, message: res.error.message, cause: String((res.error.cause as Error)?.message ?? res.error.cause ?? "").slice(0, 300) };
      // 审阅执行路径（带 submit_findings 工具，与真实审阅一致）
      if (provider !== "deepseek") {
        try {
          await (await import("../ai/call")).callFindings(
            { id: `diag-${provider}`, provider, model: req.model } as never,
            "sys",
            "【Category · 逻辑】\n检查\n\n【Document Context · 带行号全文】\nL1|样例内容。",
            { apiKey: req.apiKey },
          );
          result[`${provider}_reviewPath`] = { unexpected: "no-error" };
        } catch (e) {
          const ae = e as { kind?: string; message?: string; cause?: unknown };
          result[`${provider}_reviewPath`] = {
            kind: ae.kind,
            message: String(ae.message).slice(0, 200),
            cause: String((ae.cause as Error)?.message ?? ae.cause ?? "").slice(0, 300),
          };
        }
      }
    }
    result.ok = true;
  } catch (e) {
    result.ok = false;
    result.error = e instanceof Error ? `${e.name}: ${e.message}` : JSON.stringify(e);
  }
  result.finishedAt = new Date().toISOString();
  await writeResult("spike-result-diag.json", result);
}

/** model-config-ux 联调（tasks 4.1）：发现层 + Key 复用 + 测试连接，走真实应用运行时与 tauri fetch 通道。 */
async function modelConfigPhase(req: SpikeRequest): Promise<void> {
  const settings = useSettingsStore();
  const result: Record<string, unknown> = { phase: "model_config", startedAt: new Date().toISOString() };
  try {
    const { catalogModels, fetchRemoteModels, mergeModels } = await import("../ai/model-discovery");
    // ① 预设静态目录（离线）
    const catalog = await catalogModels("deepseek");
    result.presetCatalog = {
      ok: catalog.length >= 2,
      count: catalog.length,
      hasRecommended: catalog.some((m) => m.recommended),
      hasCtxMeta: catalog.every((m) => (m.contextWindow ?? 0) > 0),
    };
    // ② 自定义连接实时检索（真实 tauri fetch 通道 → 本地 mock /models）
    const remote = await fetchRemoteModels(customInput(req));
    result.customFetch = remote.ok
      ? { ok: true, ids: remote.models.map((m) => m.id) }
      : { ok: false, reason: remote.reason };
    // ③ 合并去重
    const merged = mergeModels(catalog, remote.ok ? [{ id: "deepseek-flash", source: "remote" }, ...remote.models] : []);
    result.mergeDedupe = {
      ok: merged.filter((m) => m.id === "deepseek-flash").length === 1 && merged.length > catalog.length,
      total: merged.length,
    };
    // ④ 保存自定义配置 → 测试连接（mock chat）→ 清理
    const cfg = await settings.addModel({
      provider: "openai-compatible",
      model: "mock-chat",
      apiKey: req.apiKey,
      baseUrl: req.baseUrl,
    });
    const { testConnection } = await import("../ai/test-connection");
    const key = await settings.getApiKey(cfg);
    const test = await testConnection(cfg, key);
    result.customTest = test.ok ? { ok: true, model: test.model } : { ok: false, error: test.error.message };
    await settings.deleteModel(cfg.id);
    // ⑤ 同 Provider Key 复用（预设 deepseek，Key 不触网）
    const a = await settings.addModel({ provider: "deepseek", model: "deepseek-flash", apiKey: "sk-spike-reuse" });
    const b = await settings.addModel({ provider: "deepseek", model: "deepseek-v4-pro" });
    const keyring = (await import("./keyring")).keyring;
    result.keyReuse = {
      ok: (await keyring.get(b.id)) === "sk-spike-reuse" && (await settings.getApiKey(b)) === "sk-spike-reuse",
      secondHasOwnEntry: !!b.keyringRef,
    };
    await settings.deleteModel(a.id);
    await settings.deleteModel(b.id);
    result.ok = true;
  } catch (e) {
    result.ok = false;
    result.error = e instanceof Error ? `${e.name}: ${e.message}` : JSON.stringify(e);
  }
  result.finishedAt = new Date().toISOString();
  await writeResult("spike-result-model-config.json", result);
}

function customInput(req: SpikeRequest): import("../ai/model-discovery").FetchModelsInput {
  return { baseUrl: req.baseUrl, apiKey: req.apiKey, family: "openai-completions" };
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
