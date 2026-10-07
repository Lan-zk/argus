// 里程碑 1 验收（tasks 2.5）：多项目多轮 e2e —— 项目/轮次落库、配置沿用与变更标记、
// 提示词版本化后新一轮用新版本、崩溃恢复（悬挂 running → partial_failed）。
// mock 仅打在 AI 边界（ai/call），orchestrator/解析/落库走真实链路。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { resetRepoForTests, getRepo } from "../lib/repo";
import { useSettingsStore } from "./settings";
import { useProjectsStore } from "./projects";
import { useSessionStore } from "./session";

vi.mock("../ai/call", () => ({
  callFindings: vi.fn(async () => [
    {
      severity: "high",
      title: "测试发现",
      quote: "样例正文",
      problem: "p",
      reason: "r",
      suggestion: "s",
    },
  ]),
}));

const DOC = "# 标题\n\n样例正文";

async function freshStores() {
  const pinia = createPinia();
  setActivePinia(pinia);
  resetRepoForTests();
  const settings = useSettingsStore();
  await settings.init();
  await settings.addModel({ provider: "openai-compatible", model: "mock", apiKey: "k", baseUrl: "http://x" });
  const projects = useProjectsStore();
  await projects.init();
  const session = useSessionStore();
  return { settings, projects, session };
}

describe("里程碑 1 e2e（tasks 2.5）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("首轮：创建项目+轮次落库，findings/runs/报告增量写入", async () => {
    const { projects, session } = await freshStores();
    await projects.createProject("季度报告 v3");
    await session.startReview(DOC, ["logic"]);

    const repo = getRepo();
    const rounds = await repo.listRounds(projects.activeProjectId!);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].number).toBe(1);
    expect(rounds[0].status).toBe("completed");
    const snap = await repo.loadRound(rounds[0].id);
    expect(snap!.findings.length).toBeGreaterThan(0);
    expect(snap!.runs[0].categoryVersion).toBe(1);
    expect(snap!.report).not.toBeNull();
    expect(session.plan?.number).toBe(1);
  });

  it("第二轮沿用配置（configChanged=false）；改提示词后新一轮默认仍沿用上轮版本（显式升级入口属 M2）", async () => {
    const { settings, projects, session } = await freshStores();
    const repo = getRepo();
    await projects.createProject("A");
    await session.startReview(DOC, ["logic"]);
    await session.startReview(DOC, ["logic"]); // R2：沿用
    let rounds = await repo.listRounds(projects.activeProjectId!);
    expect(rounds).toHaveLength(2);
    expect(rounds[1].configChanged).toBeUndefined();

    // 手动编辑提示词 → 追加 v2（tasks 2.4）
    await settings.updateCategory("logic", { prompt: "新版逻辑审阅提示词" });
    const versions = await repo.listPromptVersions("logic");
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[1].source).toBe("manual_edit");

    await session.startReview(DOC, ["logic"]); // R3：默认沿用上轮快照（spec: 新一轮配置沿用）→ 仍 v1
    rounds = await repo.listRounds(projects.activeProjectId!);
    expect(rounds).toHaveLength(3);
    expect(rounds[2].configChanged).toBeUndefined();
    const snap3 = await repo.loadRound(rounds[2].id);
    expect(snap3!.round.categorySnapshot[0].version).toBe(1);
    expect(snap3!.runs[0].categoryVersion).toBe(1);
  });

  it("崩溃恢复：悬挂 running 轮次 → init 标 partial_failed，部分结果可查看", async () => {
    const { projects, session } = await freshStores();
    const repo = getRepo();
    await projects.createProject("B");
    await session.startReview(DOC, ["logic"]);
    const rid = session.plan!.roundId;
    // 模拟崩溃：人为把已完成的轮次打回 running，再用全新 store 实例 init
    await repo.updateRoundStatus(rid, "running");

    const pinia2 = createPinia();
    setActivePinia(pinia2);
    const projects2 = useProjectsStore();
    await projects2.init();
    const rounds = await repo.listRounds(projects.activeProjectId!);
    expect(rounds[0].status).toBe("partial_failed");

    // 打开该轮：快照可读、标注未完成
    const session2 = useSessionStore();
    await session2.restoreRound((await repo.loadRound(rid))!);
    expect(session2.findings.length).toBeGreaterThan(0);
    expect(session2.showRestoreBanner).toBe(true);
  });

  it("两个项目互不干扰：各自轮次独立编号", async () => {
    const { projects, session } = await freshStores();
    const repo = getRepo();
    await projects.createProject("P1");
    await session.startReview(DOC, ["logic"]);
    projects.activeProjectId = null; // 离开 P1（列表页新建 P2）
    await projects.createProject("P2");
    await session.startReview(DOC, ["logic"]);
    const r1 = await repo.listRounds(projects.projects.find((p) => p.name === "P1")!.id);
    const r2 = await repo.listRounds(projects.projects.find((p) => p.name === "P2")!.id);
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r2[0].number).toBe(1); // P2 首轮从 1 开始
  });
});

describe("草稿生命周期（用户报告：新项目不得默认带上一个项目的审阅文本）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("审阅启动 → 文稿随轮次落库，草稿被消费清空；下一个项目输入区为空", async () => {
    const { settings, projects, session } = await freshStores();
    settings.draftText = DOC; // 等价粘贴
    await projects.createProject("A");
    await session.startReview(DOC, ["logic"]);
    expect(settings.draftText).toBe("");

    projects.activeProjectId = null; // 列表页新建 B
    await projects.createProject("B");
    expect(settings.draftText).toBe(""); // 不再带 A 的文本
  });

  it("全部类别失败（文档已创建）→ 草稿同样被消费：文稿保存在轮次中可重跑", async () => {
    const { settings, projects, session } = await freshStores();
    const { callFindings } = await import("../ai/call");
    settings.draftText = DOC;
    await projects.createProject("A");
    vi.mocked(callFindings).mockRejectedValueOnce(new Error("模型调用失败"));
    await session.startReview(DOC, ["logic"]); // run 级失败被状态机吸收，整体 failed
    expect(session.status).toBe("failed");
    expect(settings.draftText).toBe("");
    const repo = getRepo();
    const rounds = await repo.listRounds(projects.activeProjectId!);
    expect((await repo.loadRound(rounds[0].id))!.document.text).toBe(DOC); // 文稿仍在轮次里
  });

  it("启动即失败（未创建文档）→ 草稿保留，回输入页修正后可重试", async () => {
    const { settings, projects, session } = await freshStores();
    settings.draftText = DOC;
    await projects.createProject("A");
    await expect(session.startReview(DOC, [])).rejects.toThrow("未选择任何可用类别");
    expect(settings.draftText).toBe(DOC);
  });
});

describe("rerunCategory 冻结版本语义与级联（tasks 4.4）", () => {
  it("改提示词后轮内重跑：仍用本轮冻结版本，links 级联重算", async () => {
    const { settings, projects, session } = await freshStores();
    const repo = getRepo();
    await projects.createProject("C");
    await session.startReview(DOC, ["logic"]);
    await session.startReview(DOC, ["logic"]); // R2：沿用 v1
    const r2 = session.plan!.roundId;

    // 改提示词（v2 已在库），但轮内重跑必须用冻结的 v1
    await settings.updateCategory("logic", { prompt: "v2 提示词" });
    await session.rerunCategory("logic");

    const snap = await repo.loadRound(r2);
    expect(snap!.runs.every((r) => r.categoryVersion === 1)).toBe(true); // 冻结版本
    const versions = await repo.listPromptVersions("logic");
    expect(versions.map((v) => v.version)).toEqual([1, 2]); // 重跑不追加版本
    // 级联：R2 的 links 重算后存在（L1 + L2）
    const links = await repo.listLinksByRound(r2);
    expect(links.length).toBeGreaterThan(0);
    expect(links.some((l) => l.linkType === "unresolved")).toBe(true); // 文档未变 → 未动
  });
});
