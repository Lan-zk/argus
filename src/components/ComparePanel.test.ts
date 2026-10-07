// 对比面板组件测试（tasks 4.2/4.3）：去向统计与确定性标注、本轮构成、疑似遗留卡片与
// 置信度、两轮并排、配置变更提示、概率性措辞、定位跳转、首轮空态。
// 轮次切换（tasks 4.1）：点击 rtab 加载对应轮次快照。

import { describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";
import ComparePanel from "./ComparePanel.vue";
import WorkspacePage from "../pages/WorkspacePage.vue";
import { getRepo, resetRepoForTests } from "../lib/repo";
import type { DocumentRow, FindingLinkRow, FindingRow, Repo } from "../lib/repo/types";
import { useSettingsStore } from "../stores/settings";
import { useSessionStore } from "../stores/session";
import { useProjectsStore } from "../stores/projects";
import { useUiStore } from "../stores/ui";
import type { Finding } from "../domain/types";
import { withAnchors } from "../domain/anchor";

const NOW = "2026-10-04T12:00:00.000Z";
const DOC1 = "口径不一致的问题。\n第二段内容应当更加具体一些来支撑论点。\n第三段。";

async function seedTwoRounds(
  repo: Repo,
  round2Source: DocumentRow["sourceMeta"] = { kind: "paste" },
): Promise<{ r1: string; r2: string; projectId: string }> {
  const projectId = "cmp_p";
  await repo.insertProject({ id: projectId, name: "对比项目", createdAt: NOW, updatedAt: NOW });
  async function seed(number: number, docId: string, findings: FindingRow[], sourceMeta: DocumentRow["sourceMeta"]): Promise<string> {
    const roundId = `cmp_r${number}`;
    await repo.insertRound({ id: roundId, projectId, number, status: "completed", categorySnapshot: [], modelSnapshot: {}, createdAt: NOW });
    await repo.insertDocument({ id: docId, roundId, text: DOC1, sourceMeta, createdAt: NOW });
    await repo.insertBlocks(docId, [{ seq: 0, type: "paragraph", rawText: DOC1, plainText: DOC1, line: 1 }]);
    const runId = `cmp_run${number}`;
    await repo.upsertRun({ id: runId, roundId, categoryId: "logic", categoryVersion: 1, status: "completed" });
    await repo.insertFindings(findings.map((f) => ({ ...f, roundId, runId })));
    return roundId;
  }
  const r1 = await seed(1, "cmp_d1", [
    fr("pf1", { title: "口径问题", quote: "口径不一致", line: 1, contentHash: "h1" }),
    fr("pf2", { title: "论据不足", quote: "第二段内容", line: 2 }),
  ], { kind: "paste" });
  const r2 = await seed(2, "cmp_d2", [
    fr("cf1", { title: "口径问题（仍在）", quote: "口径不一致", line: 1, contentHash: "h1" }),
  ], round2Source);
  return { r1, r2, projectId };
}

function fr(id: string, over: Partial<FindingRow> = {}): FindingRow {
  return {
    id, roundId: "", runId: "", categoryId: "logic", severity: "high",
    title: "标题", quote: "引用", problem: "问题", reason: "原因", suggestion: "建议", anchorStatus: "anchored",
    ...over,
  };
}

function currentFinding(id: string, over: Partial<Finding> = {}): Finding {
  const f: Finding = {
    id, categoryId: "logic", severity: "high", title: "口径问题（仍在）", quote: "口径不一致",
    anchors: [],
    problem: "p", reason: "r", suggestion: "s", anchorStatus: "anchored", ...over,
  };
  return f.anchors.length > 0 ? f : withAnchors(f);
}

async function setupActiveRound(configChanged = false, round2Source?: DocumentRow["sourceMeta"]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  resetRepoForTests();
  const settings = useSettingsStore();
  await settings.init();
  const repo = getRepo();
  const { r1, r2, projectId } = await seedTwoRounds(repo, round2Source);
  const projects = useProjectsStore();
  await projects.init();
  projects.activeProjectId = projectId;
  await projects.refreshRounds(projectId);
  const session = useSessionStore();
  const snap = await repo.loadRound(r2);
  await session.restoreRound(snap!);
  session.plan = {
    projectId, roundId: r2, number: 2, categories: [], modelConfigId: "",
    configChanged, sourceMeta: { kind: "paste" },
  };
  session.findings = [currentFinding("cf1")];
  // links：pf1 未动（quote 在 DOC1 原样存在）、pf2 已修改（构造不存在 quote）→ 用直接插入可控数据
  await repo.deleteLinksByRound(r2);
  const links: FindingLinkRow[] = [
    { prevFindingId: "pf1", currRoundId: r2, linkType: "unresolved", computedAt: NOW },
    { prevFindingId: "pf2", currRoundId: r2, linkType: "edited", computedAt: NOW },
    { prevFindingId: "pf1", currRoundId: r2, linkType: "recurring", currFindingId: "cf1", confidence: 0.87, computedAt: NOW },
  ];
  await repo.insertLinks(links);
  return { repo, projects, session, r1, r2, projectId, settings };
}

describe("ComparePanel（tasks 4.2/4.3）", () => {
  it("去向统计 + 确定性标注 + 本轮构成 + 疑似遗留置信度", async () => {
    const { session } = await setupActiveRound();
    const w = mount(ComparePanel);
    await flushPromises();
    const text = w.text();
    expect(text).toContain("上一轮 2 个问题的去向");
    expect(text).toContain("确定性判定");
    expect(text).toContain("概率性判定");
    expect(text).toContain("本轮 1 个发现的构成");
    expect(text).toContain("疑似遗留");
    expect(text).toContain("新问题");
    expect(text).toContain("可能为同一问题 · 87%");
    // 措辞：概率性表述，无断言式文案（spec: 疑似遗留对比）
    expect(text).not.toContain("完全相同");
    expect(text).not.toContain("已确认一致");
    // 去向明细可展开
    expect(text).toContain("已修改");
    expect(text).toContain("未动");
    void session;
  });

  it("配置已变更 → 「仅供参考」提示", async () => {
    await setupActiveRound(true);
    const w = mount(ComparePanel);
    await flushPromises();
    expect(w.text()).toContain("配置已变更，对比仅供参考");
  });

  it("两轮输入方式不同（粘贴 vs 导入）→ 一致性提示（spec: document-import 跨轮输入一致性提示）", async () => {
    await setupActiveRound(false, { kind: "docx", filename: "季度报告-v3.docx", importedAt: NOW });
    const w = mount(ComparePanel);
    await flushPromises();
    expect(w.find('[data-test="input-kind-mismatch"]').exists()).toBe(true);
    expect(w.text()).toContain("两轮输入方式不同");
    w.unmount();
  });

  it("两轮同为粘贴 → 无一致性提示", async () => {
    await setupActiveRound(false);
    const w = mount(ComparePanel);
    await flushPromises();
    expect(w.find('[data-test="input-kind-mismatch"]').exists()).toBe(false);
    w.unmount();
  });

  it("点疑似遗留卡片展开两轮说法并排；定位跳转到批注页签", async () => {
    const { session } = await setupActiveRound();
    const ui = useUiStore();
    const w = mount(ComparePanel);
    await flushPromises();
    expect(w.text()).not.toContain("本轮（"); // 未展开时无并排列头
    await w.find(".rcard-head").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("口径问题（仍在）"); // 本轮列
    expect(w.findAll(".sbs-col")).toHaveLength(2); // 两轮说法并排（上一轮 / 本轮）
    // 定位：切到批注页签并选中
    await w.find(".rcard-foot .mini").trigger("click");
    expect(ui.sideTab).toBe("findings");
    expect(ui.selectedFindingId).toBe("cf1");
    void session;
  });

  it("首轮无上轮 → 空态说明（spec: 首轮无对比空态）", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    resetRepoForTests();
    const settings = useSettingsStore();
    await settings.init();
    const session = useSessionStore();
    session.plan = { projectId: "p", roundId: "r1", number: 1, categories: [], modelConfigId: "", configChanged: false, sourceMeta: { kind: "paste" } };
    const w = mount(ComparePanel);
    await flushPromises();
    expect(w.text()).toContain("还没有上一轮可对比");
  });
});

describe("工作台轮次切换（tasks 4.1）", () => {
  it("点击轮次号加载对应轮次快照（只读查看）", async () => {
    const { projects } = await setupActiveRound();
    const w = mount(WorkspacePage);
    await flushPromises();
    const tabs = w.findAll(".rtab");
    expect(tabs.length).toBe(2);
    await tabs[0].trigger("click"); // 切回第 1 轮
    await flushPromises();
    expect((projects.activeRoundId ?? "").startsWith("cmp_r1")).toBe(true);
    const session = useSessionStore();
    expect(session.plan?.number).toBe(1);
    expect(session.findings.length).toBe(2); // R1 的两条 findings
    w.unmount();
  });

  it("导入轮次：轮次信息显示来源文件名与导入时间（spec: document-import 轮次显示来源）", async () => {
    await setupActiveRound(false, { kind: "docx", filename: "季度报告-v3-修改稿.docx", importedAt: NOW });
    const w = mount(WorkspacePage);
    await flushPromises();
    const src = w.find(".round-src");
    expect(src.text()).toContain("来源");
    expect(src.text()).toContain("季度报告-v3-修改稿.docx");
    w.unmount();
  });
});
