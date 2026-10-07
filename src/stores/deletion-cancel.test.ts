// 软删撤销 + 取消审阅 + 轮次摘要（快捷键为窗口监听，随交互手测）。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { resetRepoForTests, getRepo } from "../lib/repo";
import { useSettingsStore } from "./settings";
import { useProjectsStore } from "./projects";
import { useSessionStore } from "./session";
import { useDeletionStore } from "./deletion";

vi.mock("../ai/call", () => ({
  callFindings: vi.fn(async () => [
    { severity: "high", title: "测试发现", quote: "样例正文", problem: "p", reason: "r", suggestion: "s" },
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

describe("软删 + 撤销（deletion store）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("项目：隐藏即时、库中仍在；撤销恢复；8 秒后 commit 落删", async () => {
    const { projects } = await freshStores();
    const repo = getRepo();
    const deletion = useDeletionStore();
    await projects.createProject("P1");
    const pid = projects.activeProjectId!;

    await projects.requestDeleteProject(pid);
    expect(projects.projects).toHaveLength(0); // 界面即时消失
    expect((await repo.listProjects()).length).toBe(1); // 数据仍在
    expect(deletion.active?.label).toContain("P1");

    await deletion.undo(); // 撤销 → 恢复
    expect(projects.projects).toHaveLength(1);
    expect(deletion.active).toBeNull();

    await projects.requestDeleteProject(pid);
    await deletion.commit(pid); // 落删
    expect((await repo.listProjects()).length).toBe(0);
    expect(projects.projects).toHaveLength(0);
  });

  it("轮次：软删隐藏 + 撤销恢复；落删后相邻对 links 补算", async () => {
    const { projects, session } = await freshStores();
    const repo = getRepo();
    const deletion = useDeletionStore();
    await projects.createProject("P");
    await session.startReview(DOC, ["logic"]);
    await session.startReview(DOC, ["logic"]);
    await session.startReview(DOC, ["logic"]); // 3 轮
    const rounds = await repo.listRounds(projects.activeProjectId!);
    const r2 = rounds[1];

    await projects.requestDeleteRound(r2.id);
    expect((await repo.listRounds(projects.activeProjectId!)).length).toBe(3); // 库未动
    expect(projects.activeRounds.length).toBe(2); // 界面已隐藏

    await deletion.undo();
    expect(projects.activeRounds.length).toBe(3);

    await projects.requestDeleteRound(r2.id);
    await deletion.commit(r2.id); // 真删 + 1↔3 相邻对补算
    expect((await repo.listRounds(projects.activeProjectId!)).length).toBe(2);
    const links3 = await repo.listLinksByRound(rounds[2].id);
    expect(links3.some((l) => l.prevFindingId.includes("_f"))).toBe(true); // R3 现以 R1 为 prev
  });
});

describe("取消审阅（cancelReview）", () => {
  it("运行中取消：未终态类别标失败、轮次标 partial_failed、已产出结果保留", async () => {
    const { projects, session } = await freshStores();
    const repo = getRepo();
    await projects.createProject("C");
    await session.startReview(DOC, ["logic", "clarity"]); // mocked 成功完成
    const rid = session.plan!.roundId;

    // 模拟“正在进行”：clarity 仍在跑、logic 已完成
    session.session = { ...session.session!, status: "running" };
    session.runs["clarity"] = { ...session.runs["clarity"], status: "running" };
    await repo.updateRoundStatus(rid, "running");

    await session.cancelReview();
    expect(session.session?.status).toBe("partial_failed");
    expect(session.runs["clarity"].status).toBe("failed");
    expect(session.runs["clarity"].error).toContain("取消");
    expect(session.runs["logic"].status).toBe("completed"); // 已完成的不受影响
    expect(session.findings.length).toBeGreaterThan(0); // 已产出结果保留
    const rounds = await repo.listRounds(projects.activeProjectId!);
    expect(rounds[0].status).toBe("partial_failed");
  });
});
