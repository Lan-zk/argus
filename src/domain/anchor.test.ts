// spec: finding-pipeline 定位与 unanchored 场景 + hash 规则
import { describe, expect, it } from "vitest";
import { anchorOne, hashText, normText } from "./anchor";
import { parseBlocks } from "./parser";
import type { AnchorInput } from "./anchor";

function input(over: Partial<AnchorInput> = {}): AnchorInput {
  return {
    id: "f1",
    categoryId: "logic",
    severity: "high",
    title: "测试问题",
    quote: "商业模式已经被验证",
    problem: "p",
    reason: "r",
    suggestion: "s",
    ...over,
  };
}

const DOC = [
  "l1 文本",
  "",
  "## 小节",
  "",
  "前文说明。这个商业 模式已经被验证。后续内容。",
  "这里提到商业模式已经被验证（第二处）。",
  "",
  "普通段落。",
].join("\n");
const blocks = parseBlocks(DOC);

describe("唯一命中直接定位", () => {
  it("写出块与区间定位字段", () => {
    const doc2 = parseBlocks("第一段。\n\n唯一的句子在这里。\n\n第三段。");
    const f = anchorOne(input({ quote: "唯一的句子在这里" }), doc2, "逻辑");
    expect(f.anchorStatus).toBe("anchored");
    expect(f.blockId).toBe("block_002");
    expect(f.startOffset).toBe(0);
    expect(f.endOffset).toBe("唯一的句子在这里".length);
  });
});

describe("多处命中按行号消歧", () => {
  it("quote 归一化忽略空白差异后命中两处，取与 lineHint 最接近者", () => {
    const f = anchorOne(input({ lineHint: 6 }), blocks, "逻辑");
    // L5 的命中带额外空格（归一化后命中），L6 精确命中；lineHint=6 → L6
    expect(f.anchorStatus).toBe("anchored");
    expect(f.line).toBe(6);
  });

  it("lineHint 指向 L5 时消歧至 L5（空白差异命中）", () => {
    const f = anchorOne(input({ lineHint: 5 }), blocks, "逻辑");
    expect(f.line).toBe(5);
    // 命中起点在「商业」处：块 plain 以「前文说明。这个」开头（7 字符）
    expect(f.startOffset).toBe("前文说明。这个".length);
    expect(f.endOffset).toBe("前文说明。这个商业 模式已经被验证".length);
  });
});

describe("行号提示错误以内容为准", () => {
  it("lineHint=1 而唯一命中在 L5 → 定位 L5", () => {
    const doc = parseBlocks("第一行。\n\n这一句是唯一目标语句。\n\n尾部。");
    const f = anchorOne(input({ quote: "这一句是唯一目标语句", lineHint: 1 }), doc, "逻辑");
    expect(f.anchorStatus).toBe("anchored");
    expect(f.line).toBe(3);
  });
});

describe("hash 不一致以内容为准", () => {
  it("模型给的 contentHash 错误时仍定位成功（内容匹配为准）", () => {
    const f = anchorOne(input({ contentHash: "deadbeef", lineHint: 6 }), blocks, "逻辑");
    expect(f.anchorStatus).toBe("anchored");
    expect(f.line).toBe(6);
  });
});

describe("无命中标 unanchored", () => {
  it("quote 不存在于全文 → 保留 Finding 且不高亮", () => {
    const f = anchorOne(input({ quote: "这句话根本不在原文里" }), blocks, "逻辑");
    expect(f.anchorStatus).toBe("unanchored");
    expect(f.blockId).toBeUndefined();
    expect(f.startOffset).toBeUndefined();
  });

  it("空 quote → unanchored 不抛错", () => {
    const f = anchorOne(input({ quote: "" }), blocks, "逻辑");
    expect(f.anchorStatus).toBe("unanchored");
  });
});

describe("重叠区间共存", () => {
  it("两条 Finding 覆盖同一文本的不同/相同区间互不影响", () => {
    const doc = parseBlocks("全文只有这一段内容，包含目标语句。");
    const a = anchorOne(input({ id: "fa", quote: "目标语句" }), doc, "逻辑");
    const b = anchorOne(input({ id: "fb", quote: "这一段内容，包含目标语句" }), doc, "修辞");
    expect(a.anchorStatus).toBe("anchored");
    expect(b.anchorStatus).toBe("anchored");
    // b 的区间包含 a 的区间（重叠），两者定位字段独立共存
    expect(a.startOffset!).toBeGreaterThanOrEqual(b.startOffset!);
    expect(a.endOffset!).toBeLessThanOrEqual(b.endOffset!);
  });
});

describe("hash 与归一化规则（与原型一致）", () => {
  it("djb2 8 位 hex；忽略全部空白差异", () => {
    expect(hashText("ab")).toMatch(/^[0-9a-f]{8}$/);
    expect(hashText("a b\tc")).toBe(hashText("abc"));
    expect(normText("x  y\nz")).toBe("xyz");
  });

  it("定位结果可复算 hash", () => {
    const f = anchorOne(input({ lineHint: 6 }), blocks, "逻辑");
    const block = blocks.find((b) => b.id === f.blockId)!;
    const slice = block.plainText.slice(f.startOffset!, f.endOffset!);
    expect(hashText(slice)).toBe(hashText(f.quote));
  });
});
