// pi-ai Provider 工厂（spec: ai-runtime Provider 支持 + model-config-ux 决策 2）。
// 两类入口：① 预设服务 = pi-ai 内置 Provider（惰性注册对应工厂，模型取自其静态目录）；
// ② 自定义连接 = 四家族（OpenAI / Anthropic / Google / OpenAI-compatible 自定义 baseUrl）。
// 不内置任何固定 API Key；apiKey 由调用方按次注入（钥匙串短路径读取）。

import {
  createModels,
  createProvider,
  type Context,
  type Message,
  type Model,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { ModelConfig } from "../domain/types";
import type { AppError } from "../domain/errors";
import { classifyError } from "../domain/errors";
import { presetById } from "../domain/presets";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

/** 四家族的默认上下文窗口（用户未配置 contextWindow 时的降级判定依据）；其余预设走目录元数据。 */
export const DEFAULT_CONTEXT_WINDOWS = {
  openai: 128_000,
  anthropic: 200_000,
  google: 1_000_000,
  "openai-compatible": 128_000,
} as const;

export function defaultContextWindow(provider: string): number {
  return (DEFAULT_CONTEXT_WINDOWS as Record<string, number | undefined>)[provider] ?? 128_000;
}

/** 惰性 pi-ai Provider 工厂注册表：id → 动态 import 的工厂（design 决策 2）。 */
const PI_PROVIDER_FACTORIES: Record<string, () => Promise<Provider>> = {
  deepseek: () => import("@earendil-works/pi-ai/providers/deepseek").then((m) => m.deepseekProvider()),
  moonshotai: () => import("@earendil-works/pi-ai/providers/moonshotai").then((m) => m.moonshotaiProvider()),
  "moonshotai-cn": () => import("@earendil-works/pi-ai/providers/moonshotai-cn").then((m) => m.moonshotaiCnProvider()),
  zai: () => import("@earendil-works/pi-ai/providers/zai").then((m) => m.zaiProvider()),
  "zai-coding-cn": () => import("@earendil-works/pi-ai/providers/zai-coding-cn").then((m) => m.zaiCodingCnProvider()),
  minimax: () => import("@earendil-works/pi-ai/providers/minimax").then((m) => m.minimaxProvider()),
  "minimax-cn": () => import("@earendil-works/pi-ai/providers/minimax-cn").then((m) => m.minimaxCnProvider()),
  "qwen-token-plan": () =>
    import("@earendil-works/pi-ai/providers/qwen-token-plan").then((m) => m.qwenTokenPlanProvider()),
  "qwen-token-plan-cn": () =>
    import("@earendil-works/pi-ai/providers/qwen-token-plan-cn").then((m) => m.qwenTokenPlanCnProvider()),
  "qwen-token-plan-individual": () =>
    import("@earendil-works/pi-ai/providers/qwen-token-plan-individual").then((m) => m.qwenTokenPlanIndividualProvider()),
  xiaomi: () => import("@earendil-works/pi-ai/providers/xiaomi").then((m) => m.xiaomiProvider()),
  "xiaomi-token-plan-cn": () =>
    import("@earendil-works/pi-ai/providers/xiaomi-token-plan-cn").then((m) => m.xiaomiTokenPlanCnProvider()),
  "xiaomi-token-plan-ams": () =>
    import("@earendil-works/pi-ai/providers/xiaomi-token-plan-ams").then((m) => m.xiaomiTokenPlanAmsProvider()),
  "xiaomi-token-plan-sgp": () =>
    import("@earendil-works/pi-ai/providers/xiaomi-token-plan-sgp").then((m) => m.xiaomiTokenPlanSgpProvider()),
  "ant-ling": () => import("@earendil-works/pi-ai/providers/ant-ling").then((m) => m.antLingProvider()),
  openai: () => Promise.resolve(openaiProvider()),
  anthropic: () => Promise.resolve(anthropicProvider()),
  google: () => Promise.resolve(googleProvider()),
  xai: () => import("@earendil-works/pi-ai/providers/xai").then((m) => m.xaiProvider()),
  mistral: () => import("@earendil-works/pi-ai/providers/mistral").then((m) => m.mistralProvider()),
  groq: () => import("@earendil-works/pi-ai/providers/groq").then((m) => m.groqProvider()),
  cerebras: () => import("@earendil-works/pi-ai/providers/cerebras").then((m) => m.cerebrasProvider()),
  together: () => import("@earendil-works/pi-ai/providers/together").then((m) => m.togetherProvider()),
  fireworks: () => import("@earendil-works/pi-ai/providers/fireworks").then((m) => m.fireworksProvider()),
  nvidia: () => import("@earendil-works/pi-ai/providers/nvidia").then((m) => m.nvidiaProvider()),
  huggingface: () => import("@earendil-works/pi-ai/providers/huggingface").then((m) => m.huggingfaceProvider()),
  baseten: () => import("@earendil-works/pi-ai/providers/baseten").then((m) => m.basetenProvider()),
  openrouter: () => import("@earendil-works/pi-ai/providers/openrouter").then((m) => m.openrouterProvider()),
  "vercel-ai-gateway": () =>
    import("@earendil-works/pi-ai/providers/vercel-ai-gateway").then((m) => m.vercelAIGatewayProvider()),
};

/** 预设 Provider 实例缓存（目录读取 / baseUrl / api 家族共用）。 */
const piProviderCache = new Map<string, Provider>();

export async function getPresetProvider(id: string): Promise<Provider | null> {
  if (!PI_PROVIDER_FACTORIES[id]) return null;
  let p = piProviderCache.get(id);
  if (!p) {
    p = await PI_PROVIDER_FACTORIES[id]();
    piProviderCache.set(id, p);
  }
  return p;
}

/** Models 集合缓存：预设按 Provider id 复用；自定义按配置键复用。 */
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

export async function resolveModel(cfg: ModelConfig): Promise<ResolvedCall> {
  // 预设服务：惰性注册 pi-ai 工厂，优先从静态目录取模型（元数据完整）
  const preset = presetById(cfg.provider);
  const piFactory = PI_PROVIDER_FACTORIES[cfg.provider];
  if (preset && piFactory) {
    const cacheKey = `pi:${cfg.provider}`;
    let models = modelsCache.get(cacheKey);
    if (!models) {
      models = modelsFactory();
      models.setProvider(await piFactory());
      modelsCache.set(cacheKey, models);
    }
    const fromCatalog = models.getModel(cfg.provider, cfg.model);
    if (fromCatalog) return { models, model: fromCatalog };
    // 手动输入的模型 id 不在目录 → 以目录首项的 api 家族与 Provider baseUrl 手工构建
    const provider = await getPresetProvider(cfg.provider);
    const first = provider?.getModels()[0];
    return {
      models,
      model: manual(cfg, first?.api ?? "openai-completions", provider?.baseUrl ?? "", cfg.provider),
    };
  }

  // 自定义连接：四家族
  const key = `${cfg.id}:${cfg.provider}:${cfg.model}:${cfg.baseUrl ?? ""}`;
  let models = modelsCache.get(key);
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
      default:
        // 未知 Provider id 且无工厂：按 OpenAI-compatible 处理（baseUrl 可为空，调用时失败可读）
        models.setProvider(
          createProvider({
            id: `custom-${cfg.id}`,
            name: cfg.provider,
            baseUrl: cfg.baseUrl ?? "",
            auth: { apiKey: { name: "用户配置 Key", resolve: async () => ({ auth: {} }) } },
            models: [],
            api: openAICompletionsApi(),
          }),
        );
    }
    modelsCache.set(key, models);
  }

  const model = models.getModel(fourFamilyKey(cfg), cfg.model) ?? manualModel(cfg);
  return { models, model };
}

/** openai 家族在 pi-ai 目录中的 provider id 与家族值一致；仅 openai-compatible 走 custom-id。 */
function fourFamilyKey(cfg: ModelConfig): string {
  return cfg.provider === "openai-compatible" ? `custom-${cfg.id}` : cfg.provider;
}

/** 测试钩子：清空全部缓存（隔离测试用例）。 */
export function resetModelsCacheForTests(): void {
  modelsCache.clear();
  piProviderCache.clear();
  modelsFactory = createModels;
}

/** 目录里没有的模型名 → 手工构建 Model 定义（api 按 Provider 家族）。 */
function manualModel(cfg: ModelConfig): Model<string> {
  switch (cfg.provider) {
    case "openai":
      return manual(cfg, "openai-responses", "https://api.openai.com/v1", "openai");
    case "anthropic":
      return manual(cfg, "anthropic-messages", "https://api.anthropic.com/v1", "anthropic");
    case "google":
      return manual(cfg, "google-generative-ai", "https://generativelanguage.googleapis.com/v1beta", "google");
    default:
      return manual(cfg, "openai-completions", cfg.baseUrl ?? "", `custom-${cfg.id}`);
  }
}

function manual(cfg: ModelConfig, api: string, baseUrl: string, providerKey: string): Model<string> {
  return {
    id: cfg.model,
    name: cfg.model,
    api,
    provider: providerKey,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { ...ZERO_COST },
    contextWindow: cfg.contextWindow ?? defaultContextWindow(cfg.provider),
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
