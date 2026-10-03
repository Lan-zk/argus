// PRD §60 MVP 数据对象。所有模块共享的领域类型，零框架依赖。

export type Severity = "high" | "medium" | "low";

export const SEVERITIES: Severity[] = ["high", "medium", "low"];

/** PRD §13：严重 / 建议修改 / 可优化 */
export const SEVERITY_ZH: Record<Severity, string> = {
  high: "严重",
  medium: "建议修改",
  low: "可优化",
};

/**
 * Provider 标识：四个自定义连接家族，或任一 pi-ai 内置 Provider id（预设服务，见 domain/presets.ts）。
 * 值域开放（string 联合），避免 types 与 presets 循环依赖；预设 id 由快照测试锁定。
 */
export type FourFamily = "openai" | "anthropic" | "google" | "openai-compatible";
export type ProviderKind = FourFamily | (string & {});

/** 自定义连接可选的家族。 */
export const PROVIDERS: FourFamily[] = ["openai", "anthropic", "google", "openai-compatible"];

export function isFourFamily(p: string): p is FourFamily {
  return (PROVIDERS as string[]).includes(p);
}

export const PROVIDER_ZH: Record<ProviderKind, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  "openai-compatible": "OpenAI-compatible",
};

/** PRD §21/§32。持久化时 apiKey 字段不落盘（仅内存使用），落盘的是 keyringRef。 */
export interface ModelConfig {
  id: string;
  provider: ProviderKind;
  model: string;
  apiKey?: string;
  /** 钥匙串条目引用（= 配置 id）。数据文件中只存引用，不存 Key 明文。 */
  keyringRef?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  /** 自定义显示名称（可选）：设置列表优先展示，用于快速区分多条配置。 */
  displayName?: string;
  isDefault?: boolean;
  /** 模型上下文窗口（token），用于长文降级判定；用户可不填，走 Provider 默认估算。 */
  contextWindow?: number;
}

/** 模型发现结果（spec: ai-runtime 模型发现）：静态目录或实时检索得到的可选模型。 */
export interface DiscoveredModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  /** 来源：静态目录（离线）或服务端检索。 */
  source: "catalog" | "remote";
  /** 预设推荐默认模型标记。 */
  recommended?: boolean;
}

/** PRD §16 */
export interface ReviewCategory {
  id: string;
  name: string;
  en?: string;
  description?: string;
  /** 类别色（design token 变量名），用于界面识别。 */
  color?: string;
  prompt: string;
  enabled: boolean;
  defaultSelected: boolean;
  order: number;
}

/** PRD §29 */
export type BlockType =
  | "paragraph"
  | `heading${1 | 2 | 3 | 4 | 5 | 6}`
  | "list_item"
  | "quote"
  | "code"
  | "other";

export interface DocumentBlock {
  id: string;
  type: BlockType;
  rawText: string;
  plainText: string;
  order: number;
  /** 起始行号，从 1 开始（PRD §29）。 */
  line: number;
}

export interface Document {
  id: string;
  /** 原始全文（归一化换行后）。 */
  text: string;
  blocks: DocumentBlock[];
  createdAt: string;
}

/** PRD §61 */
export type SessionStatus = "idle" | "running" | "completed" | "partial_failed" | "failed";

export interface ReviewSession {
  id: string;
  documentId: string;
  selectedCategoryIds: string[];
  status: SessionStatus;
  createdAt: string;
}

/** PRD §62 */
export type RunStatus = "pending" | "running" | "completed" | "failed";

export interface CategoryRun {
  id: string;
  reviewSessionId: string;
  categoryId: string;
  status: RunStatus;
  modelConfigId: string;
  error?: string;
  /** 降级为文档结构表示审阅时记录（PRD §36）。 */
  degraded?: boolean;
  retries?: number;
  startedAt?: string;
  completedAt?: string;
}

export type AnchorStatus = "anchored" | "unanchored";

/** PRD §32。lineHint/contentHash 来自模型；line/blockId/startOffset/endOffset 由定位算法写入。 */
export interface Finding {
  id: string;
  categoryId: string;
  severity: Severity;
  title: string;
  quote: string;
  lineHint?: number;
  contentHash?: string;
  line?: number;
  blockId?: string;
  startOffset?: number;
  endOffset?: number;
  problem: string;
  reason: string;
  suggestion: string;
  anchorStatus: AnchorStatus;
}

/** PRD §42 */
export interface CategorySummary {
  categoryId: string;
  high: number;
  medium: number;
  low: number;
  summary: string;
}

export interface ReviewReport {
  summary: string;
  priorityFindingIds: string[];
  categorySummaries: CategorySummary[];
  failedCategoryIds: string[];
  /** 程序化降级报告时为 true（design 决策 9）。 */
  degraded?: boolean;
  generatedAt: string;
}

/** 一次审阅的完整可恢复状态（app-persistence：最近一次 Review）。 */
export interface PersistedReview {
  session: ReviewSession;
  document: Document;
  runs: CategoryRun[];
  findings: Finding[];
  report: ReviewReport | null;
}

/** UI 偏好（app-persistence：界面偏好记忆）。 */
export interface UiPrefs {
  /** 左栏宽度百分比（工作台分栏），默认 60。 */
  splitPercent: number;
}

export interface AppSettings {
  models: ModelConfig[];
  categories: ReviewCategory[];
  /** New Review 当前输入文本。 */
  draftText: string;
  ui: UiPrefs;
}

/** 运行日志条目（界面「流水日志」用；不得包含完整原文与完整 API Key）。 */
export interface LogEntry {
  t: string;
  tag: string;
  msg: string;
  err?: boolean;
}
