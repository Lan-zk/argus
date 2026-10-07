// 存储层行类型与 Repo 接口（review-versioning design D1/D2）。
// SQLite 全关系表 + 混合纪律：可查询/可关联字段为真列，纯展示嵌套为 JSON 列（由实现层序列化）。
// API 面约束（tasks 1.4）：findings/documents/reports 完成后除「单类重跑」外无任何改写方法——
// 禁用方法名单见 FORBIDDEN_REPO_METHODS，契约测试断言其永不存在。

import type {
  AnchorStatus,
  BlockType,
  CategoryGroup,
  CategorySummary,
  FindingAnchor,
  ImportSource,
  RunStatus,
  SessionStatus,
  Severity,
} from "../../domain/types";

/** 分组行类型与领域 CategoryGroup 同形（分组区方法签名共用），随本模块再导出。 */
export type { CategoryGroup };

/** 存储层模型配置行（永不包含 apiKey；Key 只在系统钥匙串，库中仅 keyringRef）。 */
export interface StoredModel {
  id: string;
  provider: string;
  model: string;
  displayName?: string;
  baseUrl?: string;
  keyringRef?: string;
  isDefault?: boolean;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
}

/** 存储层类别行：prompt 为当前版本文本，currentVersion 指向 category_prompt_versions。 */
export interface StoredCategory {
  id: string;
  name: string;
  en?: string;
  description?: string;
  color?: string;
  prompt: string;
  enabled: boolean;
  defaultSelected: boolean;
  order: number;
  currentVersion: number;
  /** 所属分组（spec: settings 类别分组管理）：null/缺省 = 「通用」虚拟组。 */
  groupId?: string | null;
}

export type PromptSource = "builtin" | "manual_edit" | "skill_import";

/** 提示词版本行（append-only，永不 UPDATE/DELETE）。 */
export interface PromptVersionRow {
  categoryId: string;
  version: number;
  source: PromptSource;
  prompt: string;
  /** skill_import 来源信息（包名/文件/校验和）或 rollbackFrom 记录；JSON 语义。 */
  skillMeta?: unknown;
  createdAt: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** 轮次类别快照条目：该轮实际使用的类别与提示词版本（design D4 配置冻结）。 */
export interface CategorySnapshotEntry {
  categoryId: string;
  version: number;
}

export interface RoundRow {
  id: string;
  projectId: string;
  number: number;
  status: SessionStatus;
  categorySnapshot: CategorySnapshotEntry[];
  /** categoryId → modelConfigId。 */
  modelSnapshot: Record<string, string>;
  /** 本轮配置与上轮快照不同（对比面板「仅供参考」标记）。 */
  configChanged?: boolean;
  createdAt: string;
}

export interface DocumentRow {
  id: string;
  roundId: string;
  text: string;
  /** 来源元信息（粘贴 / txt|md|docx|pdf 导入，含文件名与时间）；JSON 列语义。 */
  sourceMeta?: ImportSource;
  createdAt: string;
}

export interface BlockRow {
  seq: number;
  type: BlockType;
  rawText: string;
  plainText: string;
  line: number;
}

export interface RunRow {
  id: string;
  roundId: string;
  categoryId: string;
  categoryVersion: number;
  modelConfigId?: string;
  status: RunStatus;
  error?: string;
  degraded?: boolean;
  retries?: number;
  startedAt?: string;
  completedAt?: string;
}

export interface FindingRow {
  id: string;
  roundId: string;
  runId: string;
  categoryId: string;
  severity: Severity;
  title: string;
  quote: string;
  lineHint?: number;
  contentHash?: string;
  line?: number;
  blockSeq?: number;
  startOffset?: number;
  endOffset?: number;
  problem: string;
  reason: string;
  suggestion: string;
  anchorStatus: AnchorStatus;
  /**
   * 多锚结构（spec: finding-anchor-spans）：primary（句级或行范围）+ 引用锚。
   * 旧列（quote/block_seq/offsets 等）恒为主锚投影——旧版本应用读新库仍可显示主锚；
   * 本字段为空（v1 历史数据）时读取方按旧列合成单主锚。
   */
  anchors?: FindingAnchor[];
}

export interface ReportRow {
  roundId: string;
  summary: string;
  priorityFindingIds: string[];
  categorySummaries: CategorySummary[];
  failedCategoryIds: string[];
  degraded?: boolean;
  generatedAt: string;
}

export type FindingLinkType = "unresolved" | "edited" | "recurring" | "ambiguous";

/** 跨轮对比结果行（design D2：一等数据，允许一个旧问题对应多条新 finding）。 */
export interface FindingLinkRow {
  prevFindingId: string;
  currRoundId: string;
  linkType: FindingLinkType;
  /** recurring 时指向本轮对应 finding。 */
  currFindingId?: string;
  /** L2 疑似遗留的匹配置信度；L1 确定性判定为空。 */
  confidence?: number;
  computedAt: string;
}

/** 轮次完整快照读取结果（loadRound）。report 在旧数据/降级报告缺失时为 null。 */
export interface RoundSnapshot {
  round: RoundRow;
  document: DocumentRow;
  blocks: BlockRow[];
  runs: RunRow[];
  findings: FindingRow[];
  report: ReportRow | null;
}

/** 降级保护（库 schema 版本高于应用）命中后一切写方法抛出。 */
export class ReadOnlyStorageError extends Error {
  constructor() {
    super("storage is read-only: database schema is newer than this app version");
    this.name = "ReadOnlyStorageError";
  }
}

/** 轮次完成后的禁改写方法名单（tasks 1.4 API 面断言；「单类重跑」路径的受限方法不在其列）。 */
export const FORBIDDEN_REPO_METHODS = [
  "updateFinding",
  "deleteFinding",
  "updateDocument",
  "deleteDocument",
  "updateBlock",
  "deleteBlock",
  "updateReport",
] as const;

export interface Repo {
  readonly kind: "memory" | "sqlite";
  /** 降级保护命中为 true：一切写方法抛 ReadOnlyStorageError。 */
  readonly readOnly: boolean;
  /** 打开底层存储并按序完成迁移（幂等；内存实现为空操作）。 */
  open(): Promise<void>;

  // ---- 设置区 ----
  listModels(): Promise<StoredModel[]>;
  putModel(m: StoredModel): Promise<void>;
  deleteModel(id: string): Promise<void>;
  listCategories(): Promise<StoredCategory[]>;
  /** upsert 类别行；若该类别尚无任何版本行，同时种入 v1（builtin）。 */
  putCategory(c: StoredCategory): Promise<void>;
  deleteCategory(id: string): Promise<void>;
  // ---- 分组区（spec: settings 类别分组管理；「通用」虚拟组不落行，不在本列表）----
  /** 自定义组按 sort_order 升序。 */
  listGroups(): Promise<CategoryGroup[]>;
  /** 插入组行（OR IGNORE 幂等）。 */
  insertGroup(g: CategoryGroup): Promise<void>;
  renameGroup(id: string, name: string): Promise<void>;
  /** 上移/下移：与相邻组交换 sort_order。 */
  moveGroup(id: string, dir: -1 | 1): Promise<void>;
  /** 删除组：组内类别回落通用（group_id=NULL），MUST NOT 删除类别；幂等（先 UPDATE 后 DELETE）。 */
  deleteGroup(id: string): Promise<void>;
  /** 调整类别归属（null=通用）。 */
  assignCategoryGroup(categoryId: string, groupId: string | null): Promise<void>;
  listPromptVersions(categoryId: string): Promise<PromptVersionRow[]>;
  getPromptVersionText(categoryId: string, version: number): Promise<string | null>;
  /** 追加新版本并前移类别 currentVersion；返回新版本号。 */
  appendPromptVersion(categoryId: string, source: PromptSource, prompt: string, skillMeta?: unknown): Promise<number>;
  getPref<T>(key: string): Promise<T | undefined>;
  setPref(key: string, value: unknown): Promise<void>;
  deletePref(key: string): Promise<void>;

  // ---- 审阅区（里程碑 1 接入：轮次生命周期与增量落库）----
  insertProject(p: ProjectRow): Promise<void>;
  listProjects(): Promise<ProjectRow[]>;
  renameProject(id: string, name: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
  insertRound(r: RoundRow): Promise<void>;
  listRounds(projectId: string): Promise<RoundRow[]>;
  /** 轮次状态更新（运行中/终态判定；崩溃恢复标 partial_failed 也走这里）。 */
  updateRoundStatus(roundId: string, status: RoundRow["status"]): Promise<void>;
  /** 删除轮次（含级联文档/运行/findings/报告；相邻对比补算属里程碑 2）。 */
  deleteRound(roundId: string): Promise<void>;
  insertDocument(d: DocumentRow): Promise<void>;
  insertBlocks(documentId: string, blocks: BlockRow[]): Promise<void>;
  upsertRun(r: RunRow): Promise<void>;
  insertFindings(rows: FindingRow[]): Promise<void>;
  /** 单类重跑的唯一 findings 改写路径：删除该类别在本轮的旧 findings（API 面允许项）。 */
  deleteCategoryFindings(roundId: string, categoryId: string): Promise<void>;
  putReport(r: ReportRow): Promise<void>;
  loadRound(roundId: string): Promise<RoundSnapshot | null>;
  insertLinks(rows: FindingLinkRow[]): Promise<void>;
  deleteLinksByRound(roundId: string): Promise<void>;
  listLinksByRound(roundId: string): Promise<FindingLinkRow[]>;
}
