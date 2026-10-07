// Review Orchestrator（spec: review-orchestration / PRD §64）。
// 会话生命周期、并发调度（池默认 3）、失败隔离、单类重跑、长文降级、完成即发布、报告触发。
// 通过 SessionSink 写入状态，UI store 与测试各提供自己的 sink 实现。

import type {
  CategoryRun,
  Document,
  Finding,
  ModelConfig,
  ReviewCategory,
  ReviewSession,
  ReviewReport,
} from "../domain/types";
import { parseBlocks } from "../domain/parser";
import { assemblePrompt, renderNumberedDocument } from "../domain/prompts";
import { normalizeFindings } from "../domain/normalizer";
import { anchorFinding } from "../domain/anchor";
import { dedupFindings } from "../domain/dedup";
import { dlog } from "../domain/log";
import { appError, type AppError } from "../domain/errors";
import { callFindings } from "../ai/call";
import { withRetry, MAX_AUTO_RETRIES } from "../ai/retry";
import { buildStructuralOutline, shouldDegrade } from "../ai/degrade";
import { ConcurrencyPool } from "./pool";
import { generateReport } from "./report";

export interface SessionSink {
  /** 会话创建 / 状态变更。 */
  setSession(session: ReviewSession): void;
  /** 解析后的文档（块模型）写入 store。 */
  setDocument(document: Document): void;
  /** run 状态变更（新建、running、终态）。 */
  putRun(run: CategoryRun): void;
  /** 完成即发布：该类别 findings 立即可见。 */
  publishFindings(categoryId: string, findings: Finding[]): void;
  /** 会话整体状态判定。 */
  setSessionStatus(status: ReviewSession["status"]): void;
  /** 报告生成完成。 */
  setReport(report: ReviewReport): void;
}

export interface OrchestratorDeps {
  /** 钥匙串短路径读取 API Key（不缓存到持久层）。 */
  getApiKey: (cfg: ModelConfig) => Promise<string>;
  /** 并发上限（默认 3）。 */
  concurrency?: number;
  signal?: AbortSignal;
}

export class Orchestrator {
  private sink: SessionSink;
  private deps: OrchestratorDeps;
  private session: ReviewSession | null = null;
  private document: Document | null = null;
  private runs = new Map<string, CategoryRun>();
  private findings: Finding[] = [];
  private report: ReviewReport | null = null;
  private fidSeq = 1;
  /** 当前模型配置与选中类别（报告生成需要）。 */
  private activeModelConfig: ModelConfig | null = null;
  private activeCategories: ReviewCategory[] = [];

  constructor(sink: SessionSink, deps: OrchestratorDeps) {
    this.sink = sink;
    this.deps = deps;
  }

  get currentSession(): ReviewSession | null {
    return this.session;
  }

  get currentFindings(): Finding[] {
    return this.findings;
  }

  /** 回灌已有会话（单类重跑前调用）：不触发 sink 事件，仅恢复内部状态。 */
  resume(
    session: ReviewSession,
    document: Document,
    runs: Record<string, CategoryRun>,
    findings: Finding[],
    report: ReviewReport | null,
  ): void {
    this.session = session;
    this.document = document;
    this.runs.clear();
    for (const r of Object.values(runs)) this.runs.set(r.categoryId, r);
    this.findings = findings;
    this.report = report;
    this.fidSeq = findings.length + 1;
  }

  private nextFindingId(): string {
    // 带会话前缀：findings.id 是全局主键，多轮间 f1/f2 会互相碰撞（轮间 id 唯一化修复）
    return `${this.session?.id ?? "s"}_f${this.fidSeq++}`;
  }

  /** 开始一次审阅（PRD §24 流程 1–5）。 */
  async start(opts: {
    text: string;
    selectedCategories: ReviewCategory[];
    modelConfig: ModelConfig;
    categoryNameOf?: (id: string) => string;
  }): Promise<void> {
    const blocks = parseBlocks(opts.text);
    this.document = {
      id: `doc_${Date.now()}`,
      text: opts.text,
      blocks,
      createdAt: new Date().toISOString(),
    };
    this.session = {
      id: `sess_${Date.now()}`,
      documentId: this.document.id,
      selectedCategoryIds: opts.selectedCategories.map((c) => c.id),
      status: "running",
      createdAt: new Date().toISOString(),
    };
    this.runs.clear();
    this.findings = [];
    this.report = null;
    this.fidSeq = 1;
    this.activeModelConfig = opts.modelConfig;
    this.activeCategories = opts.selectedCategories;
    this.sink.setSession(this.session);
    this.sink.setDocument(this.document);

    dlog("解析", `全文 ${opts.text.split("\n").length} 行 · ${blocks.length} 个段落结构（渲染与定位均基于全文行号，不做分块审阅）`);
    dlog("编排", `创建 ReviewSession · 选中 ${opts.selectedCategories.length} 个类别 · 并发上限 ${this.deps.concurrency ?? 3}（Provider 限制优先）`);

    for (const c of opts.selectedCategories) {
      const run: CategoryRun = {
        id: `run_${this.session.id}_${c.id}`,
        reviewSessionId: this.session.id,
        categoryId: c.id,
        status: "pending",
        modelConfigId: opts.modelConfig.id,
      };
      this.runs.set(c.id, run);
      this.sink.putRun(run);
    }

    await this.execute(opts.selectedCategories, opts.modelConfig, opts.categoryNameOf);
  }

  /** 单类重跑（spec: review-orchestration 单类重新运行 / PRD §28）。 */
  async rerunCategory(opts: {
    category: ReviewCategory;
    modelConfig: ModelConfig;
    categoryNameOf?: (id: string) => string;
  }): Promise<void> {
    if (!this.session || !this.document) throw new Error("没有可重跑的会话");
    // 删除该类别旧 findings
    this.findings = this.findings.filter((f) => f.categoryId !== opts.category.id);
    this.sink.publishFindings(opts.category.id, []);

    const run: CategoryRun = {
      id: `run_${this.session.id}_${opts.category.id}_r${Date.now()}`,
      reviewSessionId: this.session.id,
      categoryId: opts.category.id,
      status: "pending",
      modelConfigId: opts.modelConfig.id,
    };
    this.runs.set(opts.category.id, run);
    this.sink.putRun(run);
    this.activeModelConfig = opts.modelConfig;
    if (!this.activeCategories.some((c) => c.id === opts.category.id)) {
      this.activeCategories = [...this.activeCategories, opts.category];
    }
    this.session = { ...this.session, status: "running" };
    this.sink.setSessionStatus("running");

    await this.execute([opts.category], opts.modelConfig, opts.categoryNameOf);
    // 报告重生成由 execute 末尾统一处理（若全部终态）
  }

  /** 并行执行给定类别（并发池控制），失败隔离，全部终态后判定状态并触发报告。 */
  private async execute(
    categories: ReviewCategory[],
    modelConfig: ModelConfig,
    categoryNameOf?: (id: string) => string,
  ): Promise<void> {
    if (!this.session || !this.document) return;
    const nameOf = categoryNameOf ?? ((id: string) => categories.find((c) => c.id === id)?.name ?? id);
    const apiKey = await this.deps.getApiKey(modelConfig);
    const pool = new ConcurrencyPool(this.deps.concurrency ?? 3);

    const tasks = categories.map((category) =>
      pool.run(async () => {
        // 已取消：不再启动排队中的类别（保持 pending，由发起方整体重置状态；
        // 不标记失败以避免触发 judgeSession 的无意义报告生成）
        if (this.deps.signal?.aborted) return;
        await this.runCategory(category, modelConfig, apiKey, nameOf(category.id));
      }),
    );
    // 单项失败隔离：pool.run 的 reject 已在 runCategory 内消化，这里只需等全部终态
    await Promise.allSettled(tasks);

    await this.judgeSession();
  }

  /** 单类执行管道（spec: review-orchestration 完成即显示）：prompt → 降级判定 → 调用 → 规范化 → 定位 → 去重 → 发布。 */
  private async runCategory(
    category: ReviewCategory,
    modelConfig: ModelConfig,
    apiKey: string,
    catName: string,
  ): Promise<void> {
    if (!this.session || !this.document) return;
    const run = this.runs.get(category.id)!;
    run.status = "running";
    run.startedAt = new Date().toISOString();
    run.error = undefined;
    this.sink.putRun({ ...run });

    try {
      const numbered = renderNumberedDocument(this.document.text);
      const outline = buildStructuralOutline(this.document.blocks);
      const decision = shouldDegrade(modelConfig, numbered, outline);
      if (decision.degraded) {
        run.degraded = true;
        dlog("降级", `${catName}：${decision.reason} → 以文档结构表示整体审阅（定位算法不变）`, true);
      }

      const prompt = assemblePrompt({
        categoryName: catName,
        categoryPrompt: category.prompt,
        documentText: this.document.text,
        degraded: decision.degraded,
        structuralOutline: outline,
      });

      const rawFindings = await withRetry(
        () =>
          callFindings(modelConfig, prompt.system, prompt.user, {
            apiKey,
            signal: this.deps.signal,
          }),
        (err) => (err as AppError) ?? appError("unknown"),
        {
          signal: this.deps.signal,
          onRetry: (attempt) => {
            dlog("重试", `${catName}：网络类错误 → 第 ${attempt}/${MAX_AUTO_RETRIES} 次自动重试`, true);
            run.retries = attempt;
            this.sink.putRun({ ...run });
          },
        },
      );

      // 规范化 → 定位 → 去重
      const normalized = normalizeFindings(
        rawFindings as unknown as Array<Record<string, unknown>>,
        category.id,
        () => this.nextFindingId(),
      );
      if (normalized.dropped > 0) {
        dlog("规范化", `${catName}：丢弃 ${normalized.dropped} 条无效 Finding`);
      }
      const anchored = normalized.findings.map((f) => anchorFinding(f, this.document!.blocks, catName));
      const finalFindings = dedupFindings(anchored, catName);

      // 替换该类别 findings 并发布（重跑路径同样生效）
      this.findings = [...this.findings.filter((f) => f.categoryId !== category.id), ...finalFindings];
      this.sink.publishFindings(category.id, finalFindings);

      run.status = "completed";
      run.completedAt = new Date().toISOString();
      this.sink.putRun({ ...run });
      dlog("执行", `${catName}：完成 · ${finalFindings.length} 条 findings`);
    } catch (err) {
      const appErr = (err as AppError)?.kind ? (err as AppError) : appError("unknown", "", err);
      run.status = "failed";
      run.error = this.deps.signal?.aborted ? "已取消本次审阅" : appErr.message;
      run.completedAt = new Date().toISOString();
      this.sink.putRun({ ...run });
      dlog("执行", `${catName}：${run.error === "已取消本次审阅" ? "已取消" : `失败 → ${appErr.message}`}`, true);
    }
  }

  /** 整体状态判定（spec: review-orchestration 状态机）：全部终态后判 completed / partial_failed / failed。 */
  private async judgeSession(): Promise<void> {
    if (!this.session) return;
    if (this.deps.signal?.aborted) return; // 已取消：不判终态、不生成报告（由发起方重置状态）
    const runs = [...this.runs.values()].filter((r) =>
      this.session!.selectedCategoryIds.includes(r.categoryId),
    );
    const allTerminal = runs.every((r) => r.status === "completed" || r.status === "failed");
    if (!allTerminal) return;

    const failed = runs.filter((r) => r.status === "failed");
    const status: ReviewSession["status"] =
      failed.length === 0 ? "completed" : failed.length === runs.length ? "failed" : "partial_failed";
    this.session = { ...this.session, status };
    this.sink.setSessionStatus(status);
    dlog("编排", `会话终态 ${status}（${runs.length - failed.length} 成功 / ${failed.length} 失败）`);

    // 报告：全部终态后自动生成（首跑或重跑后均触发，满足「重跑触发报告更新」）
    await this.generateReportNow();
  }

  private async generateReportNow(): Promise<void> {
    if (!this.session || !this.document) return;
    const failedCategoryIds = [...this.runs.values()]
      .filter((r) => r.status === "failed")
      .map((r) => r.categoryId);
    const report = await generateReport({
      document: this.document,
      findings: this.findings,
      categories: this.activeCategories,
      failedCategoryIds,
      modelConfig: this.activeModelConfig,
      apiKey: this.activeModelConfig ? await this.deps.getApiKey(this.activeModelConfig) : "",
      signal: this.deps.signal,
    });
    this.report = report;
    this.sink.setReport(report);
    dlog("报告", `汇总报告已生成（${report.degraded ? "程序化降级" : "模型"}）· 优先问题 ${report.priorityFindingIds.length} 条`);
  }

  /** 供持久化：完整会话快照。 */
  snapshot(): {
    session: ReviewSession;
    document: Document;
    runs: CategoryRun[];
    findings: Finding[];
    report: ReviewReport | null;
  } | null {
    if (!this.session || !this.document) return null;
    return {
      session: this.session,
      document: this.document,
      runs: [...this.runs.values()],
      findings: this.findings,
      report: this.report,
    };
  }
}
