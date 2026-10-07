// 跨轮对比引擎测试（tasks 3.1–3.4）：L1 三类判定与边界、L2 高低置信与多对一、
// 删轮补算、重跑级联。阈值即 spike 结论（常量在 round-links.ts）。

import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRepo } from "./repo/memory";
import type { FindingRow, Repo } from "./repo/types";
import { recomputeRoundLinks, recomputeAfterDeletion, cascadeRerunLinks, L2_LINK_MIN } from "./round-links";
import { buildLineDiff } from "../domain/rounddiff";
import { bigramSimilarity, bestWindowMatch } from "../domain/textsim";
import { normalizeNewlines, normText } from "../domain/normalize";

const NOW = "2026-10-04T12:00:00.000Z";

async function seedRound(
  repo: Repo,
  projectId: string,
  number: number,
  text: string,
  findings: FindingRow[],
): Promise<string> {
  const roundId = `r${number}_${projectId}`;
  const docId = `d${number}_${projectId}`;
  await repo.insertRound({
    id: roundId, projectId, number, status: "completed",
    categorySnapshot: [], modelSnapshot: {}, createdAt: NOW,
  });
  await repo.insertDocument({ id: docId, roundId, text, sourceMeta: { kind: "paste" }, createdAt: NOW });
  await repo.insertBlocks(docId, [{ seq: 0, type: "paragraph", rawText: text, plainText: text, line: 1 }]);
  const runId = `run${number}_${projectId}`;
  await repo.upsertRun({ id: runId, roundId, categoryId: "logic", categoryVersion: 1, status: "completed" });
  await repo.insertFindings(findings.map((f) => ({ ...f, roundId, runId })));
  return roundId;
}

function finding(id: string, over: Partial<FindingRow> = {}): FindingRow {
  return {
    id, roundId: "", runId: "", categoryId: "logic", severity: "high",
    title: "问题标题", quote: "旧问题引用文本", problem: "问题描述文本",
    reason: "r", suggestion: "s", anchorStatus: "anchored",
    ...over,
  };
}

describe("rounddiff 位置映射（tasks 3.1）", () => {
  it("未动行保持映射；改词行断开映射并记入变更集", () => {
    const prev = "第一段原文\n第二段原文\n第三段原文";
    const curr = "第一段原文\n第二段改写\n第三段原文";
    const d = buildLineDiff(prev, curr);
    expect(d.lineMap.get(1)).toBe(1);
    expect(d.lineMap.get(3)).toBe(3);
    expect(d.lineMap.get(2)).toBeNull();
    expect(d.changedCurrLines.has(2)).toBe(true);
  });

  it("挪段：行内容不变仅顺序变化 → 全部行可映射到新位置", () => {
    const prev = "甲\n乙\n丙";
    const curr = "丙\n甲\n乙";
    const d = buildLineDiff(prev, curr);
    expect(d.lineMap.get(1)).toBe(2); // 甲 → 第 2 行
    expect(d.lineMap.get(2)).toBe(3); // 乙 → 第 3 行
    // 丙在 prev 位置视为删除、在 curr 位置视为新增（挪段 = 删+增，锚定靠未动行）
    expect(d.lineMap.get(3)).toBeNull();
    expect(d.changedCurrLines.has(1)).toBe(true);
  });
});

describe("textsim（spike 三粒度）", () => {
  it("改词 → 高相似；重写 → 低相似；normText 去空白不敏感", () => {
    const q = "用户留存率同比提升28个百分点";
    const wordEdited = "用户留存率同比提升35个百分点";
    const rewritten = "本季度增长主要由新客拉动";
    expect(bigramSimilarity(q, wordEdited)).toBeGreaterThan(0.7);
    expect(bigramSimilarity(q, rewritten)).toBeLessThan(0.3);
    expect(normText("a b\nc")).toBe("abc");
    expect(normalizeNewlines("a\r\nb\rc")).toBe("a\nb\nc");
  });
});

describe("L1 确定性判定（tasks 3.2）", () => {
  let repo: MemoryRepo;
  beforeEach(() => {
    repo = new MemoryRepo();
  });

  it("未动 / 已修改 / 待确认 三类与 links 落库", async () => {
    const doc1 = "用户留存率同比提升28个百分点。\n另一段内容。\n旧问题引用文本在这里。";
    await seedRound(repo, "p1", 1, doc1, [
      finding("f_keep", { quote: "用户留存率同比提升28个百分点", line: 1 }),
      finding("f_gone", { quote: "旧问题引用文本在这里", line: 3 }),
      finding("f_ambig", { quote: "另一段落的内容应当更加具体一些来支撑论点", line: 2 }),
    ]);
    // 构造边界：第二段相对第一轮文本改一词 → 待确认；第三段完全重写 → 已修改
    const doc2b = "用户留存率同比提升28个百分点。\n另一段落的内容应当更加具体明确一些来支撑论点。\n这段已经完全重写了。";
    const r2 = await seedRound(repo, "p1", 2, doc2b, [finding("fn1")]);
    void r2;
    await recomputeRoundLinks(repo, "r1_p1", "r2_p1");
    const links = await repo.listLinksByRound("r2_p1");
    // L1 行与 L2 行并存于同一轮（L2 用 currFindingId 区分）；三类判定看 L1 行
    const byPrev = new Map(links.filter((l) => l.linkType !== "recurring").map((l) => [l.prevFindingId, l]));
    expect(byPrev.get("f_keep")?.linkType).toBe("unresolved"); // 原样存在
    expect(byPrev.get("f_gone")?.linkType).toBe("edited"); // 已不存在
    expect(byPrev.get("f_ambig")?.linkType).toBe("ambiguous"); // 改词 → 高相似但不精确
    expect(links.filter((l) => l.linkType !== "recurring").every((l) => l.confidence === undefined)).toBe(true); // L1 确定性判定无置信度
  });

  it("挪段：引用原样存在（仅位置变化）→ 未动", async () => {
    const doc1 = "甲问题句。\n乙。\n丙。";
    const doc2 = "乙。\n丙。\n甲问题句。";
    await seedRound(repo, "p2", 1, doc1, [finding("f1", { quote: "甲问题句", line: 1 })]);
    await seedRound(repo, "p2", 2, doc2, []);
    await recomputeRoundLinks(repo, "r1_p2", "r2_p2");
    const links = await repo.listLinksByRound("r2_p2");
    expect(links[0].linkType).toBe("unresolved");
  });
});

describe("L2 疑似遗留（tasks 3.3）", () => {
  let repo: MemoryRepo;
  beforeEach(() => {
    repo = new MemoryRepo();
  });

  it("hash 精确 → 高置信；改写后同类同位置近似 → 过阈；无关 → 不链接", async () => {
    const doc1 = "活跃用户口径不一致的问题描述第一行。\n第二行。";
    const doc2 = doc1; // 文档未变：位置映射全保留
    await seedRound(repo, "p3", 1, doc1, [
      finding("p_hash", { title: "口径不一致", problem: "活跃用户口径前后矛盾", quote: "活跃用户口径", line: 1, contentHash: "ab12" }),
      finding("p_sim", { title: "缺少数据来源", problem: "关键数据未注明统计口径", quote: "第二行", line: 2 }),
    ]);
    await seedRound(repo, "p3", 2, doc2, [
      finding("c_hash", { title: "口径不一致（复述）", problem: "完全不同的措辞但 hash 相同", quote: "活跃用户口径", line: 1, contentHash: "ab12" }),
      finding("c_sim", { title: "缺少数据来源与口径", problem: "关键数据未注明统计口径与时间段", quote: "第二行", line: 2 }),
      finding("c_other", { title: "标题层级混乱", problem: "章节结构需要调整", quote: "第二行", line: 2 }),
    ]);
    await recomputeRoundLinks(repo, "r1_p3", "r2_p3");
    const recurring = (await repo.listLinksByRound("r2_p3")).filter((l) => l.linkType === "recurring");
    const pairs = new Set(recurring.map((l) => `${l.prevFindingId}->${l.currFindingId}`));
    expect(pairs.has("p_hash->c_hash")).toBe(true); // hash 精确
    const hashLink = recurring.find((l) => l.prevFindingId === "p_hash")!;
    expect(hashLink.confidence).toBeGreaterThanOrEqual(0.95);
    expect(pairs.has("p_sim->c_sim")).toBe(true); // 同类 + 同位置 + 标题/问题相近
    const simLink = recurring.find((l) => l.prevFindingId === "p_sim")!;
    expect(simLink.confidence).toBeGreaterThan(L2_LINK_MIN);
    expect([...pairs].some((x) => x.endsWith("->c_other"))).toBe(false); // 无关不链接
  });

  it("多对一：一个旧问题对应两条新 finding 均链接（含置信度）", async () => {
    const doc = "同一段文本。\n第二行。";
    await seedRound(repo, "p4", 1, doc, [
      finding("old1", { title: "逻辑跳跃问题", problem: "结论缺乏论据支撑", quote: "同一段文本", line: 1 }),
    ]);
    await seedRound(repo, "p4", 2, doc, [
      finding("newA", { title: "逻辑跳跃问题", problem: "结论缺乏论据支撑", quote: "同一段文本", line: 1 }),
      finding("newB", { title: "逻辑跳跃问题仍在", problem: "结论缺乏论据支撑", quote: "同一段文本", line: 1 }),
    ]);
    await recomputeRoundLinks(repo, "r1_p4", "r2_p4");
    const recurring = (await repo.listLinksByRound("r2_p4")).filter((l) => l.linkType === "recurring");
    expect(recurring.map((l) => l.currFindingId).sort()).toEqual(["newA", "newB"]);
  });
});

describe("级联与删轮补算（tasks 3.4）", () => {
  let repo: MemoryRepo;
  beforeEach(() => {
    repo = new MemoryRepo();
  });

  it("重算先作废旧 links（deleteLinksByRound 后重写）", async () => {
    const doc = "稳定文本一行。";
    await seedRound(repo, "p5", 1, doc, [finding("o1")]);
    const r2 = await seedRound(repo, "p5", 2, doc, [finding("n1")]);
    await repo.insertLinks([{ prevFindingId: "o1", currRoundId: r2, linkType: "recurring", currFindingId: "n1", confidence: 0.5, computedAt: NOW }]);
    await recomputeRoundLinks(repo, "r1_p5", r2);
    const links = await repo.listLinksByRound(r2);
    // 旧手工插入的行已作废；重写后 = o1 的 L1 行 + 重算出的 recurring 行
    expect(links.length).toBe(2);
    expect(links.some((l) => l.prevFindingId === "o1" && l.linkType === "edited")).toBe(true); // 默认 quote 不在文中 → 已修改
    expect(links.filter((l) => l.linkType === "recurring").length).toBe(1);
  });

  it("删除中间轮次 → 新相邻对（1↔3）补算", async () => {
    await seedRound(repo, "p6", 1, "文本甲。", [finding("a1")]);
    await seedRound(repo, "p6", 2, "文本甲。", [finding("b1")]);
    await seedRound(repo, "p6", 3, "文本甲。", [finding("c1")]);
    // 删 R2 → 1 与 3 成为相邻对
    await repo.deleteRound("r2_p6");
    const ok = await recomputeAfterDeletion(repo, "p6", 2); // 删除位两侧（1 与 3）成为新相邻对
    expect(ok).toBe(true);
    const links = await repo.listLinksByRound("r3_p6");
    expect(links.some((l) => l.prevFindingId === "a1")).toBe(true);
    // R2 的 links 已随轮次删除（级联）
    expect(await repo.listLinksByRound("r2_p6")).toHaveLength(0);
  });

  it("cascadeRerunLinks：重跑轮的对比与其后一轮（以其为 prev）均重算", async () => {
    await seedRound(repo, "p7", 1, "文本乙。", [finding("x1")]);
    await seedRound(repo, "p7", 2, "文本乙。", [finding("x2")]);
    await seedRound(repo, "p7", 3, "文本乙。", [finding("x3")]);
    await cascadeRerunLinks(repo, "p7", 2);
    const l3 = await repo.listLinksByRound("r3_p7");
    expect(l3.some((l) => l.prevFindingId === "x2")).toBe(true); // R3 以重跑后的 R2 为 prev 重算
  });

  it("bestWindowMatch 返回最佳窗口行号", () => {
    const m = bestWindowMatch("完全独特的关键句子XYZ", "前文若干。\n完全独特的关键句子XYZ在这里。\n结尾。");
    expect(m.line).toBe(2);
    expect(m.best).toBeGreaterThan(0.5);
  });
});
