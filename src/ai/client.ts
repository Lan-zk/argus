// pi-ai Provider 工厂（spec: ai-runtime Provider 支持）。
// 四类 Provider：OpenAI / Anthropic / Google / OpenAI-compatible（自定义 baseUrl/model/apiKey）。
// 不内置任何固定 API Key；apiKey 由调用方按次注入（钥匙串短路径读取）。

import {
  createModels,
  createProvider,
  type Context,
  type Message,
  type Model,
  type MutableModels,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { ModelConfig } from "../domain/types";
import type { AppError } from "../domain/errors";
import { classifyError } from "../domain/errors";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

/** 各 Provider 的默认上下文窗口（用户未配置 contextWindow 时的降级判定依据）。 */
export const DEFAULT_CONTEXT_WINDOWS: Record<ModelConfig["provider"], number> = {
  openai: 128_000,
  anthropic: 200_000,
  google: 1_000_000,
  "openai-compatible": 128_000,
};

/** 模型清单缓存：同一条 ModelConfig 复用同一个 Models 实例。 */
const modelsCache = new Map<string, MutableModels>();

export interface ResolvedCall {
  models: MutableModels;
  model: Model<string>;
}

/** 测试钩子：注入自定义 Models 工厂（faux provider 集成测试用）。 */
let modelsFactory: () => MutableModels = createModels;
export function setModelsFactoryForTests(f: () => MutableModels): void {
  modelsFactory = f;
}

export function resolveModel(cfg: ModelConfig): ResolvedCall {
  const key = `${cfg.id}:${cfg.provider}:${cfg.model}:${cfg.baseUrl ?? ""}`;
  let models: MutableModels | undefined = modelsCache.get(key);
  if (!models) {
    models = modelsFactory();
    switch (cfg.provider) {
      case "openai":
        models.setProvider(openaiProvider());
        break;
      case "anthropic":
        models.setProvider(anthropicProvider());
        break;
      case "google":
        models.setProvider(googleProvider());
        break;
      case "openai-compatible": {
        const provider = createProvider({
          id: `custom-${cfg.id}`,
          name: `OpenAI-compatible (${cfg.baseUrl ?? "未配置 Base URL"})`,
          baseUrl: cfg.baseUrl ?? "",
          auth: { apiKey: { name: "用户配置 Key", resolve: async () => ({ auth: {} }) } },
          models: [],
          api: openAICompletionsApi(),
        });
        models.setProvider(provider);
        break;
      }
    }
    modelsCache.set(key, models);
  }

  const model =
    models.getModel(cfg.provider, cfg.model) ?? manualModel(cfg);
  return { models, model };
}

/** 测试钩子：清空 Models 缓存（隔离测试用例）。 */
export function resetModelsCacheForTests(): void {
  modelsCache.clear();
  modelsFactory = createModels;
}

/** 目录里没有的模型名 → 手工构建 Model 定义（api 按 Provider 家族）。 */
function manualModel(cfg: ModelConfig): Model<string> {
  switch (cfg.provider) {
    case "openai":
      return manual(cfg, "openai-responses", "https://api.openai.com/v1");
    case "anthropic":
      return manual(cfg, "anthropic-messages", "https://api.anthropic.com/v1");
    case "google":
      return manual(cfg, "google-generative-ai", "https://generativelanguage.googleapis.com/v1beta");
    case "openai-compatible":
      return manual(cfg, "openai-completions", cfg.baseUrl ?? "");
  }
}

function manual(cfg: ModelConfig, api: string, baseUrl: string): Model<string> {
  return {
    id: cfg.model,
    name: cfg.model,
    api,
    provider: cfg.provider === "openai-compatible" ? `custom-${cfg.id}` : cfg.provider,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { ...ZERO_COST },
    contextWindow: cfg.contextWindow ?? DEFAULT_CONTEXT_WINDOWS[cfg.provider],
    maxTokens: cfg.maxTokens ?? 8192,
  };
}

export function makeContext(systemPrompt: string, messages: Message[], tools: Context["tools"]): Context {
  return { systemPrompt, messages, tools };
}

/** 统一的调用入口错误包装：任何异常 → AppError（已脱敏）。 */
export function toAppError(err: unknown, knownKeys: string[] = []): AppError {
  return classifyError(err, knownKeys);
}
