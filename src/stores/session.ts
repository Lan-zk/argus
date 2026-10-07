// sessionStore（design 决策 2 → review-versioning 里程碑 1）：
// ReviewSession / CategoryRun / Findings / 报告的内存态 + SQLite 增量落库（双写 sink）。
// 审阅在项目下以「轮次」运行：配置沿用上轮快照（提示词版本冻结）、崩溃后部分结果可恢复。

import { defineStore } from "pinia";
import type {
  CategoryRun,
  Document,
  Finding,
  ImportSource,
  ReviewReport,
  ReviewSession,
  Severity,
} from "../domain/types";
import { setDomainLogger } from "../domain/log";
import { Orchestrator, type SessionSink } from "../orchestrator/orchestrator";
import { getRepo } from "../lib/repo";
import type {
  BlockRow,
  FindingRow,
  RoundRow,
  RoundSnapshot,
} from "../lib/repo/types";
import { useSettingsStore } from "./settings";
import { useProjectsStore } from "./projects";
import { recomputeRoundLinks, cascadeRerunLinks } from "../lib/round-links";
import { withAnchors, syncProjection } from "../domain/anchor";
import { dlog } from "../domain/log";

/** 解析后的执行计划：一轮的冻结配置（spec: 新一轮配置沿用 / 轮次与不可变快照）。 */
export interface RoundPlan {
  projectId: string;
  roundId: string;
  number: number;
  /** 冻结后的类别（prompt 已取版本表文本）。 */
  categories: { id: string; name: string; prompt: string; version: number }[];
  modelConfigId: string;
  configChanged: boolean;
  /** 本轮文档来源（spec: document-import 来源元数据；粘贴轮次为 paste）。 */
  sourceMeta: ImportSource;
}

export const useSessionStore = defineStore("session", {
  state: () => ({
    session: null as ReviewSession | null,
    document: null as Document | null,
    runs: {} as Record<string, CategoryRun>,
    findings: [] as Finding[],
    report: null as ReviewReport | null,
    /** 当前轮次上下文。 */
    plan: null as RoundPlan | null,
    /** 当前轮次文档来源（spec: document-import 来源元数据；轮次切换随快照回灌）。 */
    documentSource: null as ImportSource | null,
    /** 恢复提示条可见性（重启恢复 / 未完成轮次场景）。 */
    showRestoreBanner: false,
    /** 界面日志（工作台流水日志）。 */
    logs: [] as { t: string; tag: string; msg: string; err?: boolean }[],
  }),

  getters: {
    status: (s): ReviewSession["status"] => s.session?.status ?? "idle",
    runList: (s) => Object.values(s.runs),
    isRunning: (s) => s.session?.status === "running",
    findingsOf: (s) => (categoryId: string) => s.findings.filter((f) => f.categoryId === categoryId),
    wordCount: (s) => s.document?.text.length ?? 0,
    roundNumber: (s) => s.plan?.number ?? null,
    configChanged: (s) => s.plan?.configChanged ?? false,
  },

  actions: {
    /** 挂接领域日志 → 界面流水。 */
    bindLogger() {
      setDomainLogger((tag, msg, err) => {
        const d = new Date();
        const t = [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, "0")).join(":");
        this.logs.push({ t, tag, msg, err });
        if (this.logs.length > 300) this.logs.shift();
      });
    },

    sink(plan: RoundPlan): SessionSink {
      const repo = getRepo();
      // 增量落库为后台写入：即时发起、失败仅记日志不阻塞界面（spec: 中断轮次部分结果可恢复）
      const track = (p: Promise<unknown>) => void p.catch((e) => dlog("落库", `写入失败（不影响界面）：${String(e)}`, true));
      const blockSeqOf = new Map((this.document?.blocks ?? []).map((b) => [b.id, b.order]));
      const toRows = (categoryId: string, fs: Finding[]): FindingRow[] =>
        fs.map((f) => ({
          id: f.id,
          roundId: plan.roundId,
          runId: `run_${plan.roundId}_${categoryId}`,
          categoryId: f.categoryId,
          severity: f.severity,
          title: f.title,
          quote: f.quote,
          ...(f.lineHint !== undefined ? { lineHint: f.lineHint } : {}),
          ...(f.contentHash !== undefined ? { contentHash: f.contentHash } : {}),
          ...(f.line !== undefined ? { line: f.line } : {}),
          ...(f.blockId !== undefined && blockSeqOf.has(f.blockId) ? { blockSeq: blockSeqOf.get(f.blockId)! } : {}),
          ...(f.startOffset !== undefined ? { startOffset: f.startOffset } : {}),
          ...(f.endOffset !== undefined ? { endOffset: f.endOffset } : {}),
          problem: f.problem,
          reason: f.reason,
          suggestion: f.suggestion,
          anchorStatus: f.anchorStatus,
          anchors: f.anchors,
        }));
      const self = this;
      return {
        setSession: (session) => {
          self.session = session;
        },
        setDocument: (document) => {
          self.document = document;
          const blocks: BlockRow[] = document.blocks.map((b) => ({
            seq: b.order, type: b.type, rawText: b.rawText, plainText: b.plainText, line: b.line,
          }));
          for (const b of blocks) blockSeqOf.set(`block_${String(b.seq + 1).padStart(3, "0")}`, b.seq);
          track(repo.insertDocument({
            id: document.id, roundId: plan.roundId, text: document.text,
            sourceMeta: plan.sourceMeta, createdAt: document.createdAt,
          }));
          track(repo.insertBlocks(document.id, blocks));
        },
        putRun: (run) => {
          self.runs[run.categoryId] = run;
          const ver = plan.categories.find((c) => c.id === run.categoryId)?.version ?? 1;
          track(repo.upsertRun({
            id: run.id, roundId: plan.roundId, categoryId: run.categoryId, categoryVersion: ver,
            ...(run.modelConfigId ? { modelConfigId: run.modelConfigId } : {}),
            status: run.status,
            ...(run.error !== undefined ? { error: run.error } : {}),
            ...(run.degraded !== undefined ? { degraded: run.degraded } : {}),
            ...(run.retries !== undefined ? { retries: run.retries } : {}),
            ...(run.startedAt !== undefined ? { startedAt: run.startedAt } : {}),
            ...(run.completedAt !== undefined ? { completedAt: run.completedAt } : {}),
          }));
        },
        publishFindings: (categoryId, findings) => {
          self.findings = [...self.findings.filter((f) => f.categoryId !== categoryId), ...findings];
          track(repo.deleteCategoryFindings(plan.roundId, categoryId));
          if (findings.length > 0) track(repo.insertFindings(toRows(categoryId, findings)));
        },
        setSessionStatus: (status) => {
          if (self.session) self.session = { ...self.session, status };
          track(repo.updateRoundStatus(plan.roundId, status));
        },
        setReport: (report) => {
          self.report = report;
          track(repo.putReport({
            roundId: plan.roundId,
            summary: report.summary,
            priorityFindingIds: report.priorityFindingIds,
            categorySummaries: report.categorySummaries,
            failedCategoryIds: report.failedCategoryIds,
            ...(report.degraded !== undefined ? { degraded: report.degraded } : {}),
            generatedAt: report.generatedAt,
          }));
        },
      };
    },

    /**
     * 开始一轮审阅（spec: review-versioning 新一轮配置沿用）。
     * 无项目上下文时创建新项目（首轮用当前提示词版本与默认模型）；
     * 活动项目已有轮次时默认沿用上一轮快照配置。
     */
    async startReview(
      text: string,
      selectedCategoryIds: string[],
      opts?: { projectName?: string; sourceMeta?: ImportSource },
    ) {
      const settings = useSettingsStore();
      const projects = useProjectsStore();
      await projects.init();
      const repo = getRepo();

      const project = projects.activeProject ?? (await projects.createProject(opts?.projectName ?? "未命名审阅"));
      const prevRound = (projects.roundsByProject[project.id] ?? [])[
        (projects.roundsByProject[project.id] ?? []).length - 1
      ] ?? null;
      const number = (prevRound?.number ?? 0) + 1;

      // 配置解析：类别版本沿用上轮快照，新增类别用当前版本；模型沿用上轮（缺失回退默认）
      const storedCats = await repo.listCategories();
      const versionOf = (id: string): number =>
        prevRound?.categorySnapshot.find((x) => x.categoryId === id)?.version
        ?? storedCats.find((c) => c.id === id)?.currentVersion ?? 1;
      const effective: RoundPlan["categories"] = [];
      for (const id of selectedCategoryIds) {
        const cat = settings.categoryById(id);
        if (!cat) continue;
        const version = versionOf(id);
        const prompt = (await repo.getPromptVersionText(id, version)) ?? cat.prompt;
        effective.push({ id, name: cat.name, prompt, version });
      }
      if (effective.length === 0) throw new Error("未选择任何可用类别");
      const prevModelId = prevRound ? Object.values(prevRound.modelSnapshot)[0] : undefined;
      const model = settings.models.find((m) => m.id === prevModelId) ?? settings.defaultModel;
      if (!model) throw new Error("没有可用模型配置");

      // 配置变更检测：类别集合 / 任一版本 / 模型 与上轮快照不同（spec: 对比「仅供参考」标记）
      let configChanged = false;
      if (prevRound) {
        const prevIds = prevRound.categorySnapshot.map((e) => e.categoryId).sort().join(",");
        const nowIds = [...effective.map((c) => c.id)].sort().join(",");
        configChanged =
          prevIds !== nowIds ||
          effective.some((c) => {
            const prev = prevRound.categorySnapshot.find((e) => e.categoryId === c.id);
            return prev !== undefined && prev.version !== c.version;
          }) ||
          (prevModelId !== undefined && prevModelId !== model.id);
      }

      const roundId = `round_${Date.now()}`;
      const plan: RoundPlan = {
        projectId: project.id, roundId, number, categories: effective,
        modelConfigId: model.id as string, configChanged,
        sourceMeta: opts?.sourceMeta ?? { kind: "paste" },
      };
      this.plan = plan;
      this.documentSource = plan.sourceMeta;
      this.runs = {};
      this.findings = [];
      this.report = null;
      this.document = null; // 旧轮文档不跨轮残留（草稿消费判定依赖「本轮是否已创建文档」）
      this.showRestoreBanner = false;

      const roundRow: RoundRow = {
        id: roundId, projectId: project.id, number, status: "running",
        categorySnapshot: effective.map((c) => ({ categoryId: c.id, version: c.version })),
        modelSnapshot: Object.fromEntries(effective.map((c) => [c.id, model.id])),
        ...(configChanged ? { configChanged: true } : {}),
        createdAt: new Date().toISOString(),
      };
      await projects.registerRound(roundRow);
      // L1 即时检查（确定性、未调用模型）：文档确认即计算上轮问题去向（spec: 即时「改没改」检查）
      if (prevRound) {
        await recomputeRoundLinks(getRepo(), prevRound.id, roundId);
      }

      const orchestrator = new Orchestrator(this.sink(plan), {
        getApiKey: (cfg) => settings.getApiKey(cfg),
        signal: freshAbortSignal(),
      });
      try {
        const cats = effective.map((c) => {
          const base = settings.categoryById(c.id)!;
          return { ...base, prompt: c.prompt };
        });
        await orchestrator.start({
          text,
          selectedCategories: cats,
          modelConfig: model,
          categoryNameOf: (id) => settings.categoryById(id)?.name ?? id,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        for (const r of Object.values(this.runs)) {
          if (r.status === "pending" || r.status === "running") {
            this.runs[r.categoryId] = { ...r, status: "failed", error: msg, completedAt: new Date().toISOString() };
          }
        }
        if (this.session && this.session.status === "running") {
          this.session = { ...this.session, status: "failed" };
          await repo.updateRoundStatus(roundId, "failed");
        }
        throw e;
      } finally {
        // 草稿消费语义：文稿已随轮次创建并落库（成败皆然），草稿即被用掉——清空，
        // 避免带入下一个项目/新一轮的输入区（用户报告：新项目默认带上个项目的文本）。
        // 文档未创建（启动即失败，如无可用模型）时保留草稿，供回输入页修正后重试。
        if (this.document) await settings.resetDraft();
      }
      await projects.refreshRounds(project.id);
    },

    /** 单类重跑（spec: 单类重新运行——使用本轮冻结的提示词版本）。 */
    async rerunCategory(categoryId: string) {
      if (!this.plan || !this.session || !this.document) throw new Error("没有可重跑的轮次");
      const settings = useSettingsStore();
      const repo = getRepo();
      const frozen = this.plan.categories.find((c) => c.id === categoryId);
      const category = settings.categoryById(categoryId);
      if (!frozen || !category) throw new Error("没有可用类别");
      const prompt = (await repo.getPromptVersionText(categoryId, frozen.version)) ?? category.prompt;
      const modelId = this.plan.modelConfigId;
      const model = settings.models.find((m) => m.id === modelId) ?? settings.defaultModel;
      if (!model) throw new Error("没有可用模型配置");

      const orchestrator = new Orchestrator(this.sink(this.plan), {
        getApiKey: (cfg) => settings.getApiKey(cfg),
        signal: freshAbortSignal(),
      });
      await orchestrator.resume(this.session, this.document, this.runs, this.findings, this.report);
      await orchestrator.rerunCategory({
        category: { ...category, prompt },
        modelConfig: model,
        categoryNameOf: (id) => settings.categoryById(id)?.name ?? id,
      });
      this.findings = orchestrator.currentFindings;
      const finalSession = orchestrator.currentSession;
      if (finalSession) {
        this.session = finalSession;
        await getRepo().updateRoundStatus(this.plan.roundId, finalSession.status);
      }
      // 级联：该轮作为 curr 的对比重算；若存在下一轮，其以本轮为 prev 的 links 也作废重算（tasks 3.4）
      await cascadeRerunLinks(getRepo(), this.plan.projectId, this.plan.number);
    },

    /** 打开历史轮次：把库中快照回灌 store（spec: 轮次可按序号切换查看）。 */
    async restoreRound(snap: RoundSnapshot, opts?: { banner?: boolean }) {
      const blockIdOf = (seq: number) => `block_${String(seq + 1).padStart(3, "0")}`;
      const versionOf = (categoryId: string) =>
        snap.round.categorySnapshot.find((e) => e.categoryId === categoryId)?.version ?? 1;
      const modelConfigId = Object.values(snap.round.modelSnapshot)[0];
      this.documentSource = snap.document.sourceMeta ?? { kind: "paste" };

      this.session = {
        id: snap.round.id,
        documentId: snap.document.id,
        selectedCategoryIds: snap.round.categorySnapshot.map((e) => e.categoryId),
        status: snap.round.status,
        createdAt: snap.round.createdAt,
      };
      this.document = {
        id: snap.document.id,
        text: snap.document.text,
        blocks: snap.blocks.map((b) => ({
          id: blockIdOf(b.seq), type: b.type, rawText: b.rawText, plainText: b.plainText, order: b.seq, line: b.line,
        })),
        createdAt: snap.document.createdAt,
      };
      this.runs = {};
      for (const r of snap.runs) {
        this.runs[r.categoryId] = {
          id: r.id, reviewSessionId: snap.round.id, categoryId: r.categoryId,
          status: r.status, modelConfigId: r.modelConfigId ?? "",
          ...(r.error !== undefined ? { error: r.error } : {}),
          ...(r.degraded !== undefined ? { degraded: r.degraded } : {}),
          ...(r.retries !== undefined ? { retries: r.retries } : {}),
          ...(r.startedAt !== undefined ? { startedAt: r.startedAt } : {}),
          ...(r.completedAt !== undefined ? { completedAt: r.completedAt } : {}),
        };
      }
      // anchors 为锚定真源：行内 anchors 缺失（旧数据）时由旧列合成单主锚（spec: finding-anchor-spans 兼容读）
      this.findings = snap.findings.map((f) => {
        const base = {
          id: f.id, categoryId: f.categoryId, severity: f.severity, title: f.title, quote: f.quote,
          ...(f.lineHint !== undefined ? { lineHint: f.lineHint } : {}),
          ...(f.contentHash !== undefined ? { contentHash: f.contentHash } : {}),
          ...(f.line !== undefined ? { line: f.line } : {}),
          ...(f.blockSeq !== undefined ? { blockId: blockIdOf(f.blockSeq) } : {}),
          ...(f.startOffset !== undefined ? { startOffset: f.startOffset } : {}),
          ...(f.endOffset !== undefined ? { endOffset: f.endOffset } : {}),
          problem: f.problem, reason: f.reason, suggestion: f.suggestion, anchorStatus: f.anchorStatus,
        };
        if (!f.anchors || f.anchors.length === 0) return withAnchors(base);
        return syncProjection({ ...base, anchors: f.anchors }, undefined);
      });
      this.report = snap.report
        ? {
            summary: snap.report.summary,
            priorityFindingIds: snap.report.priorityFindingIds,
            categorySummaries: snap.report.categorySummaries,
            failedCategoryIds: snap.report.failedCategoryIds,
            ...(snap.report.degraded !== undefined ? { degraded: snap.report.degraded } : {}),
            generatedAt: snap.report.generatedAt,
          }
        : null;
      this.plan = {
        projectId: snap.round.projectId, roundId: snap.round.id, number: snap.round.number,
        categories: snap.round.categorySnapshot.map((e) => {
          const name = useSettingsStore().categoryById(e.categoryId)?.name ?? e.categoryId;
          return { id: e.categoryId, name, prompt: "", version: versionOf(e.categoryId) };
        }),
        modelConfigId: modelConfigId ?? "",
        configChanged: snap.round.configChanged === true,
        sourceMeta: this.documentSource,
      };
      this.showRestoreBanner = opts?.banner ?? snap.round.status === "partial_failed";
      dlog("恢复", `已打开第 ${snap.round.number} 轮（${this.findings.length} 条 findings${snap.round.status === "partial_failed" ? " · 该轮未完成" : ""}）`);
    },

    /** 清除当前视图状态（不删数据；数据归项目/轮次管理）。 */
    async clearAndNew() {
      activeAbort?.abort();
      activeAbort = null;
      this.session = null;
      this.document = null;
      this.runs = {};
      this.findings = [];
      this.report = null;
      this.plan = null;
      this.showRestoreBanner = false;
      const settings = useSettingsStore();
      await settings.resetDraft();
    },

    /** 取消当前审阅（AbortController 已全链路预留）：未终态类别标失败，轮次标 partial_failed，已产出结果保留。 */
    async cancelReview() {
      if (!this.session || this.session.status !== "running") return;
      activeAbort?.abort();
      // 给进行中的 runCategory 一轮微任务时间落地「已取消」终态
      await new Promise((r) => setTimeout(r, 120));
      const msg = "已取消本次审阅";
      for (const r of Object.values(this.runs)) {
        if (r.status === "pending" || r.status === "running") {
          this.runs[r.categoryId] = { ...r, status: "failed", error: msg, completedAt: new Date().toISOString() };
        }
      }
      const anyDone = Object.values(this.runs).some((r) => r.status === "completed");
      this.session = { ...this.session, status: anyDone ? "partial_failed" : "failed" };
      if (this.plan) {
        await getRepo().updateRoundStatus(this.plan.roundId, this.session.status);
        await useProjectsStore().refreshRounds(this.plan.projectId);
      }
      dlog("编排", "审阅已取消：已产出结果保留，该轮标记为未完成", true);
    },

    /** 全文（供 NewReview 前端校验与渲染）。 */
    setText(text: string) {
      const settings = useSettingsStore();
      void settings.setDraftText(text);
    },
  },
});

export type SeverityFilter = Severity | "all";

// ---- 取消通道（安全审计修复：AbortSignal 全链路预留但无人传入，请求挂起时资源无法回收）----
/** 当前审阅的 AbortController（模块级，不进 Pinia state）。 */
let activeAbort: AbortController | null = null;

/** 发起新审阅/重跑前调用：中止上一条链路，返回新 signal。 */
function freshAbortSignal(): AbortSignal {
  activeAbort?.abort();
  activeAbort = new AbortController();
  return activeAbort.signal;
}
