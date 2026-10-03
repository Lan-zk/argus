// 预设服务清单（spec: settings 模型配置管理 / design 决策 1）。
// 收录标准：pi-ai 目录支持 + 纯 API Key 鉴权 + 公网固定端点。
// 清单与 pi-ai 版本一起演进；新增 Provider = 改这张表。

export type PresetGroup = "cn" | "global" | "aggregator";

export interface ModelPreset {
  /** pi-ai Provider id（写入 ModelConfig.provider）。 */
  id: string;
  name: string;
  en?: string;
  group: PresetGroup;
  /** 地域/套餐变体标注（如「国际」「国内」）。 */
  region?: string;
  /** 推荐默认模型 id（必须存在于该 Provider 静态目录）。 */
  recommendedModel: string;
}

export const GROUP_ZH: Record<PresetGroup, string> = {
  cn: "国内服务",
  global: "国际服务",
  aggregator: "聚合平台",
};

export const MODEL_PRESETS: ModelPreset[] = [
  // ---- 国内 ----
  { id: "deepseek", name: "DeepSeek", en: "DeepSeek", group: "cn", recommendedModel: "deepseek-flash" },
  { id: "moonshotai", name: "Kimi", en: "Moonshot AI", group: "cn", region: "国际端点", recommendedModel: "kimi-k3" },
  { id: "moonshotai-cn", name: "Kimi", en: "Moonshot AI", group: "cn", region: "国内端点", recommendedModel: "kimi-k3" },
  { id: "zai", name: "智谱", en: "Z.AI", group: "cn", region: "国际端点", recommendedModel: "glm-5.3" },
  { id: "zai-coding-cn", name: "智谱", en: "Z.AI", group: "cn", region: "国内端点", recommendedModel: "glm-5.3-flash" },
  { id: "minimax", name: "MiniMax", en: "MiniMax", group: "cn", region: "国际端点", recommendedModel: "MiniMax-M2.7" },
  { id: "minimax-cn", name: "MiniMax", en: "MiniMax", group: "cn", region: "国内端点", recommendedModel: "MiniMax-M2.7" },
  { id: "qwen-token-plan", name: "阿里 Qwen", en: "Qwen Token Plan", group: "cn", region: "海外区", recommendedModel: "qwen3.8-max" },
  { id: "qwen-token-plan-cn", name: "阿里 Qwen", en: "Qwen Token Plan", group: "cn", region: "国内区", recommendedModel: "qwen3.8-max" },
  { id: "qwen-token-plan-individual", name: "阿里 Qwen", en: "Qwen Token Plan", group: "cn", region: "个人版", recommendedModel: "glm-5.2" },
  { id: "xiaomi", name: "小米 MiMo", en: "Xiaomi MiMo", group: "cn", region: "国际端点", recommendedModel: "mimo-v2.5-pro" },
  { id: "xiaomi-token-plan-cn", name: "小米 MiMo", en: "Xiaomi MiMo", group: "cn", region: "国内区", recommendedModel: "mimo-v2.5-pro" },
  { id: "xiaomi-token-plan-ams", name: "小米 MiMo", en: "Xiaomi MiMo", group: "cn", region: "欧洲区", recommendedModel: "mimo-v2.5-pro" },
  { id: "xiaomi-token-plan-sgp", name: "小米 MiMo", en: "Xiaomi MiMo", group: "cn", region: "新加坡区", recommendedModel: "mimo-v2.5-pro" },
  { id: "ant-ling", name: "蚂蚁 Ling", en: "Ant Ling", group: "cn", recommendedModel: "Ling-2.6-flash" },
  // ---- 国际 ----
  { id: "openai", name: "OpenAI", en: "OpenAI", group: "global", recommendedModel: "gpt-5.5" },
  { id: "anthropic", name: "Anthropic", en: "Anthropic", group: "global", recommendedModel: "claude-sonnet-5" },
  { id: "google", name: "Google", en: "Google Gemini", group: "global", recommendedModel: "gemini-3.8-flash" },
  { id: "xai", name: "xAI", en: "xAI Grok", group: "global", recommendedModel: "grok-4.7" },
  { id: "mistral", name: "Mistral", en: "Mistral AI", group: "global", recommendedModel: "mistral-medium-latest" },
  { id: "groq", name: "Groq", en: "Groq", group: "global", recommendedModel: "llama-3.3-70b-versatile" },
  { id: "cerebras", name: "Cerebras", en: "Cerebras", group: "global", recommendedModel: "qwen-3.8-27b" },
  { id: "together", name: "Together AI", en: "Together AI", group: "global", recommendedModel: "deepseek-ai/DeepSeek-V4.1-Flash" },
  { id: "fireworks", name: "Fireworks", en: "Fireworks AI", group: "global", recommendedModel: "accounts/fireworks/models/deepseek-v4p1-flash" },
  { id: "nvidia", name: "NVIDIA", en: "NVIDIA NIM", group: "global", recommendedModel: "meta/llama-3.2-90b-vision-instruct" },
  { id: "huggingface", name: "Hugging Face", en: "Hugging Face", group: "global", recommendedModel: "deepseek-ai/DeepSeek-V3" },
  { id: "baseten", name: "Baseten", en: "Baseten", group: "global", recommendedModel: "deepseek-ai/DeepSeek-V4.1-Flash" },
  // ---- 聚合 ----
  { id: "openrouter", name: "OpenRouter", en: "OpenRouter", group: "aggregator", recommendedModel: "anthropic/claude-haiku-4.5" },
  { id: "vercel-ai-gateway", name: "Vercel AI Gateway", en: "Vercel AI Gateway", group: "aggregator", recommendedModel: "alibaba/qwen-3-235b" },
];

export const PRESET_IDS = MODEL_PRESETS.map((p) => p.id);

export function presetById(id: string): ModelPreset | undefined {
  return MODEL_PRESETS.find((p) => p.id === id);
}

/** 展示名（含变体标注）：预设 Provider 或自定义 4 家族兜底。 */
export function displayProviderName(id: string, familyZh?: string): string {
  const p = presetById(id);
  if (!p) return familyZh ?? id;
  return p.region ? `${p.name}（${p.region}）` : p.name;
}
