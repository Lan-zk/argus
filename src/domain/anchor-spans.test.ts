// spec: finding-anchor-spans —— 多锚定位（行范围互验/收敛/防滥用、引用锚、投影一致性）单测。

import { describe, expect, it } from "vitest";
import { anchorFinding, RANGE_MAX_LINES, primaryAnchorOf } from "./anchor";
import { normalizeFindings } from "./normalizer";
import { dedupFindings } from "./dedup";
import { parseBlocks } from "./parser";
import type { Finding } from "./types";

/** N 段文档：每段一行，段间空行（块 i 起始行 = 2i+1）。 */
function docOf(paragraphs: string[]): ReturnType<typeof parseBlocks> {
  return parseBlocks(paragraphs.join("\n\n"));
}

const BASE = {
  categoryId: "logic",
  severity: "high" as const,
  title: "结论扩大",
  problem: "p",
  reason: "r",
  suggestion: "s",
};

function finding(
  anchors: Finding["anchors"],
  over: Partial<Finding> = {},
): Finding {
  return { id: "f1", quote: anchors[0]?.quote ?? "", anchorStatus: "unanchored", anchors, ...BASE, ...over };
}

const P = (quote: string, extra: Partial<Finding["anchors"][number]> = {}): Finding["anchors"][number] => ({
  role: "primary",
  scope: "quote",
  quote,
  anchorStatus: "unanchored",
  ...extra,
});
const R = (quote: string): Finding["anchors"][number] => ({
  role: "ref",
  scope: "quote",
  quote,
  anchorStatus: "unanchored",
});

describe("行范围主锚（spec: 三信号定位——互验与收敛）", () => {
  it("范围包含代表句 → 锚定并保留范围", () => {
    const blocks = docOf(["第一段铺垫。", "第二段展开论证。", "第三段总结。"]);
    const f = finding([P("第二段展开论证。", { scope: "range", fromLine: 3, toLine: 5 })]);
    const out = anchorFinding(f, blocks, "逻辑");
    const a = primaryAnchorOf(out)!;
    expect(a.anchorStatus).toBe("anchored");
    expect(a.fromLine).toBe(3);
    expect(a.toLine).toBe(5);
    expect(a.blockId).toBe("block_002"); // 首个覆盖块
    // 投影一致性：顶层字段 ≡ 主锚
    expect(out.blockId).toBe(a.blockId);
    expect(out.anchorStatus).toBe("anchored");
    expect(out.quote).toBe("第二段展开论证。");
  });

  it("代表句命中不在所报范围内 → 以内容命中为准收敛到所在块", () => {
    const blocks = docOf(["第一段。", "第二段展开论证。", "第三段。"]);
    const f = finding([P("第二段展开论证。", { scope: "range", fromLine: 1, toLine: 1 })]);
    const a = primaryAnchorOf(anchorFinding(f, blocks, "逻辑"))!;
    expect(a.anchorStatus).toBe("anchored");
    expect(a.fromLine).toBe(3);
    expect(a.toLine).toBe(3); // 收敛为命中块 L3–L3
  });

  it("行号越界 clamp 到文档边界", () => {
    const blocks = docOf(["一", "二", "三", "四", "五", "六"]);
    const f = finding([P("五", { scope: "range", fromLine: 9, toLine: 20 })]);
    const a = primaryAnchorOf(anchorFinding(f, blocks, "逻辑"))!;
    // clamp 后 9→9 仍越界：命中行 L9 不在 [9,12] 内（clamp 后）→ 收敛到命中块
    expect(a.anchorStatus).toBe("anchored");
    expect(a.toLine!).toBeLessThanOrEqual(11); // 文档共 11 行
  });

  it("范围超 120 行 → 收敛为代表句所在块（防滥用）", () => {
    const paras = Array.from({ length: 200 }, (_, i) => `第${i + 1}段内容。`);
    const blocks = docOf(paras); // 399 行
    const f = finding([P("第150段内容。", { scope: "range", fromLine: 1, toLine: RANGE_MAX_LINES + 50 })]);
    const a = primaryAnchorOf(anchorFinding(f, blocks, "逻辑"))!;
    const hitBlock = blocks.find((b) => b.plainText === "第150段内容。")!;
    expect(a.fromLine).toBe(hitBlock.line);
    expect(a.toLine).toBe(hitBlock.line);
  });

  it("范围超文档一半 → 收敛为代表句所在块", () => {
    const paras = Array.from({ length: 20 }, (_, i) => `第${i + 1}段。`);
    const blocks = docOf(paras);
    const f = finding([P("第10段。", { scope: "range", fromLine: 1, toLine: 30 })]);
    const a = primaryAnchorOf(anchorFinding(f, blocks, "逻辑"))!;
    expect(a.fromLine).toBe(19);
    expect(a.toLine).toBe(19);
  });
});

describe("引用锚（spec: 未定位 Finding——ref 失败不连累主批注）", () => {
  const blocks = docOf(["论据在这里。", "结论扩大了范围。"]);

  it("引用锚命中 → 独立定位", () => {
    const f = finding([P("结论扩大了范围。"), R("论据在这里。")]);
    const out = anchorFinding(f, blocks, "逻辑");
    expect(out.anchors[1].anchorStatus).toBe("anchored");
    expect(out.anchors[1].blockId).toBe("block_001");
  });

  it("引用锚未命中 → Finding 与主锚高亮保留，ref 标未定位", () => {
    const f = finding([P("结论扩大了范围。"), R("原文中不存在的引用。")]);
    const out = anchorFinding(f, blocks, "逻辑");
    expect(out.anchorStatus).toBe("anchored");
    expect(out.anchors[0].anchorStatus).toBe("anchored");
    expect(out.anchors[1].anchorStatus).toBe("unanchored");
    expect(out.anchors[1].blockId).toBeUndefined();
  });

  it("主锚未命中 → 整条 unanchored（ref 状态不影响判定）", () => {
    const f = finding([P("不存在的句子。"), R("论据在这里。")]);
    const out = anchorFinding(f, blocks, "逻辑");
    expect(out.anchorStatus).toBe("unanchored");
  });
});

describe("规范化 span/refs（spec: ai-runtime 格式契约）", () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    severity: "high",
    title: "结论扩大",
    quote: "结论扩大了范围。",
    problem: "p",
    reason: "r",
    suggestion: "s",
    ...over,
  });

  it("不返回新字段 → anchors 仅主锚（句级），行为同旧版", () => {
    const { findings } = normalizeFindings([raw()], "logic", () => "f1");
    expect(findings[0].anchors).toHaveLength(1);
    expect(findings[0].anchors[0]).toMatchObject({ role: "primary", scope: "quote" });
  });

  it("合法 span/refs 完整保留", () => {
    const { findings } = normalizeFindings(
      [raw({ span: { fromLine: 3, toLine: 5 }, refs: [{ quote: "论据。", lineHint: 1 }] })],
      "logic",
      () => "f1",
    );
    expect(findings[0].anchors).toHaveLength(2);
    expect(findings[0].anchors[0]).toMatchObject({ scope: "range", fromLine: 3, toLine: 5 });
    expect(findings[0].anchors[1]).toMatchObject({ role: "ref", quote: "论据。", lineHint: 1 });
  });

  it("refs 超 2 条截断；空 quote 引用丢弃", () => {
    const { findings } = normalizeFindings(
      [raw({ refs: [{ quote: "一" }, { quote: "" }, { quote: "三" }, { quote: "四" }] })],
      "logic",
      () => "f1",
    );
    expect(findings[0].anchors.filter((a) => a.role === "ref").map((a) => a.quote)).toEqual(["一", "三"]);
  });

  it("非法 span（缺字段/负数）忽略 → 主锚回退句级", () => {
    const a = normalizeFindings([raw({ span: { fromLine: 3 } })], "logic", () => "f1").findings[0];
    expect(a.anchors[0].scope).toBe("quote");
    const b = normalizeFindings([raw({ span: { fromLine: -1, toLine: 0 } })], "logic", () => "f2").findings[0];
    expect(b.anchors[0].scope).toBe("quote");
  });
});

describe("同类去重以主锚为键（spec: 同类去重）", () => {
  const mk = (quote: string, refs: string[], id: string): Finding =>
    finding([P(quote), ...refs.map(R)], { id, problem: "同一个问题。" });

  it("主锚相同、引用不同 → 合并", () => {
    const out = dedupFindings([mk("同一句话。", ["引用一"], "a"), mk("同一句话。", ["引用二"], "b")], "逻辑");
    expect(out).toHaveLength(1);
  });

  it("主锚不同、引用相同 → 不合并", () => {
    const out = dedupFindings([mk("这句话。", ["共同引用。"], "a"), mk("另一句话。", ["共同引用。"], "b")], "逻辑");
    expect(out).toHaveLength(2);
  });
});
