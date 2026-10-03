// 模型发现（spec: ai-runtime 模型发现 / design 决策 3）。
// 三层：静态目录（离线）→ GET {baseUrl}/models 实时检索 → 手动输入（由 UI 提供，不在本模块）。
// 检索请求经 globalThis.fetch（Tauri WebView 内即 tauri http 通道）；错误复用 classifyError（可读 + 脱敏）。

import type { DiscoveredModel, ModelConfig } from "../domain/types";
import { classifyError } from "../domain/errors";
import { getPresetProvider } from "./client";
import { presetById } from "../domain/presets";

/**
 * 静态目录：读取 pi-ai 内置目录（离线可用，含 contextWindow/maxTokens 元数据）。
 * 推荐默认模型带 recommended 标记。未知 Provider id 返回空数组。
 */
export async function catalogModels(providerId: string): Promise<DiscoveredModel[]> {
  const provider = await getPresetProvider(providerId);
  if (!provider) return [];
  const recommended = presetById(providerId)?.recommendedModel;
  return provider.getModels().map((m) => ({
    id: m.id,
    name: m.name,
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
    source: "catalog" as const,
    recommended: m.id === recommended || undefined,
  }));
}

export interface FetchModelsInput {
  baseUrl: string;
  apiKey: string;
  /** api 家族：决定鉴权头形态；google 家族不支持 OpenAI 兼容 /models，直接降级。 */
  family?: string;
}

export type FetchModelsResult =
  | { ok: true; models: DiscoveredModel[] }
  | { ok: false; reason: string; error?: import("../domain/errors").AppError };

/** OpenAI 兼容约定的端点拼接：baseUrl 去尾斜杠 + /models（已含 /v1 的直接追加）。 */
function modelsUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "") + "/models";
}

/**
 * 实时检索：GET {baseUrl}/models。
 * openai 家族 → Bearer；anthropic 家族 → Bearer + anthropic-version；google 家族 → 不支持，静默降级（静态目录 + 手动输入兜底）。
 * 任何失败按 classifyError 归类返回可读原因，不抛异常。
 */
export async function fetchRemoteModels(input: FetchModelsInput): Promise<FetchModelsResult> {
  if (!input.baseUrl.trim()) {
    return { ok: false, reason: "Base URL 为空" };
  }
  if (input.family === "google-generative-ai" || input.family === "google") {
    return { ok: false, reason: "该服务暂不支持在线检索模型，请从列表选择或手动输入模型 ID" };
  }
  const headers: Record<string, string> = { authorization: `Bearer ${input.apiKey}` };
  if (input.family === "anthropic-messages" || input.family === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
  }
  try {
    const res = await fetch(modelsUrl(input.baseUrl), { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const appErr = classifyError(new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`), [input.apiKey]);
      return { ok: false, reason: appErr.message, error: appErr };
    }
    const json = (await res.json()) as { data?: Array<{ id?: unknown }>; models?: Array<{ id?: unknown }> };
    const list = json.data ?? json.models ?? [];
    const models: DiscoveredModel[] = [];
    for (const item of list) {
      if (typeof item?.id === "string" && item.id.trim() !== "") {
        models.push({ id: item.id, source: "remote" });
      }
    }
    return { ok: true, models };
  } catch (err) {
    const appErr = classifyError(err, [input.apiKey]);
    return { ok: false, reason: appErr.message, error: appErr };
  }
}

/** 合并去重：静态项优先（保留元数据），远端仅补充目录之外的模型。 */
export function mergeModels(catalog: DiscoveredModel[], remote: DiscoveredModel[]): DiscoveredModel[] {
  const seen = new Set(catalog.map((m) => m.id));
  return [...catalog, ...remote.filter((m) => !seen.has(m.id))];
}

/** 预设端点解析：model 级优先（opencode 系列仅存于模型条目），provider 级兜底。 */
export function endpointOf(provider: import("@earendil-works/pi-ai").Provider): string | null {
  return provider.getModels()[0]?.baseUrl || provider.baseUrl || null;
}

/** 预设服务的检索输入（端点与家族取自注册的 pi-ai Provider 及其目录）。 */
export async function presetFetchInput(providerId: string, apiKey: string): Promise<FetchModelsInput | null> {
  const provider = await getPresetProvider(providerId);
  if (!provider) return null;
  const baseUrl = endpointOf(provider);
  if (!baseUrl) return null;
  const first = provider.getModels()[0];
  return { baseUrl, apiKey, family: first?.api };
}

/** 自定义连接的检索输入（按四家族映射 api 家族）。 */
export function customFetchInput(cfg: Pick<ModelConfig, "baseUrl" | "provider">, apiKey: string): FetchModelsInput {
  const family =
    cfg.provider === "anthropic"
      ? "anthropic-messages"
      : cfg.provider === "google"
        ? "google-generative-ai"
        : "openai-completions";
  return { baseUrl: cfg.baseUrl ?? "", apiKey, family };
}
