// sessionStore（design 决策 2）：ReviewSession / CategoryRun / Findings / 报告。
// 实现 SessionSink：orchestrator 产出增量写入，UI 只读渲染（完成即发布）。
// 同时负责最近一次 Review 的持久化与恢复（spec: app-persistence）。

import { defineStore } from "pinia";
import type {
  CategoryRun,
  Finding,
  ReviewReport,
  ReviewSession,
  Severity,
} from "../domain/types";
import { setDomainLogger } from "../domain/log";
import { Orchestrator, type SessionSink } from "../orchestrator/orchestrator";
import { clearLastReview, saveLastReview } from "../lib/persistence";
import { useSettingsStore } from "./settings";
import { dlog } from "../domain/log";

export const useSessionStore = defineStore("session", {
  state: () => ({
    session: null as ReviewSession | null,
    document: null as import("../domain/types").Document | null,
    runs: {} as Record<string, CategoryRun>,
    findings: [] as Finding[],
    report: null as ReviewReport | null,
    /** 恢复提示条可见性（重启恢复场景）。 */
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

    sink(): SessionSink {
      return {
        setSession: (session) => {
          this.session = session;
        },
        setDocument: (document) => {
          this.document = document;
        },
        putRun: (run) => {
          this.runs[run.categoryId] = run;
        },
        publishFindings: (categoryId, findings) => {
          this.findings = [...this.findings.filter((f) => f.categoryId !== categoryId), ...findings];
        },
        setSessionStatus: (status) => {
          if (this.session) this.session = { ...this.session, status };
        },
        setReport: (report) => {
          this.report = report;
        },
      };
    },

    /** 开始审阅（PRD §24）。 */
    async startReview(text: string, selectedCategoryIds: string[]) {
      const settings = useSettingsStore();
      const model = settings.defaultModel;
      if (!model) throw new Error("没有可用模型配置");
      const categories = settings.categories.filter((c) => selectedCategoryIds.includes(c.id));
      this.runs = {};
      this.findings = [];
      this.report = null;
      this.showRestoreBanner = false;
      const orchestrator = new Orchestrator(this.sink(), {
        getApiKey: (cfg) => settings.getApiKey(cfg),
      });
      await orchestrator.start({
        text,
        selectedCategories: categories,
        modelConfig: model,
        categoryNameOf: (id) => settings.categoryById(id)?.name ?? id,
      });
      await this.persistReview();
    },

    /** 单类重跑（spec: review-orchestration）。 */
    async rerunCategory(categoryId: string) {
      const settings = useSettingsStore();
      const model = settings.defaultModel;
      const category = settings.categoryById(categoryId);
      if (!model || !category) throw new Error("没有可用模型配置或类别");
      const orchestrator = new Orchestrator(this.sink(), {
        getApiKey: (cfg) => settings.getApiKey(cfg),
      });
      // 复位内存态到 orchestrator 可续跑的形状：重跑前回灌当前会话
      await orchestrator.resume(this.session!, this.document!, this.runs, this.findings, this.report);
      await orchestrator.rerunCategory({
        category,
        modelConfig: model,
        categoryNameOf: (id) => settings.categoryById(id)?.name ?? id,
      });
      // 回写结果
      this.findings = orchestrator.currentFindings;
      this.session = orchestrator.currentSession;
      await this.persistReview();
    },

    async persistReview() {
      if (!this.session || !this.document) return;
      await saveLastReview({
        session: this.session,
        document: this.document,
        runs: Object.values(this.runs),
        findings: this.findings,
        report: this.report,
      });
    },

    /** 重启恢复：把持久化的最近一次 Review 回灌到 store。 */
    restore(persisted: NonNullable<ReturnType<typeof useSettingsStore>["lastReview"]>) {
      if (!persisted) return;
      this.session = persisted.session;
      this.document = persisted.document;
      this.runs = {};
      for (const r of persisted.runs) this.runs[r.categoryId] = r;
      this.findings = persisted.findings;
      this.report = persisted.report;
      this.showRestoreBanner = true;
      dlog("恢复", `已恢复最近一次 Review（${persisted.findings.length} 条 findings）`);
    },

    /** 清除并新建（spec: app-persistence 清除并新建场景）。 */
    async clearAndNew() {
      await clearLastReview();
      this.session = null;
      this.document = null;
      this.runs = {};
      this.findings = [];
      this.report = null;
      this.showRestoreBanner = false;
      const settings = useSettingsStore();
      await settings.resetDraft();
    },

    /** 全文（供 NewReview 前端校验与渲染）。 */
    setText(text: string) {
      // document 对象在开始审阅时由 orchestrator 创建；这里仅维护草稿
      const settings = useSettingsStore();
      void settings.setDraftText(text);
    },
  },
});

export type SeverityFilter = Severity | "all";
