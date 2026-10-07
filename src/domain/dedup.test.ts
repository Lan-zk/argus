// spec: finding-pipeline 去重两场景
import { describe, expect, it } from "vitest";
import { dedupFindings, similarity } from "./dedup";
import { withAnchors } from "./anchor";
import type { Finding } from "./types";

let n = 0;
function mk(over: Partial<Finding> = {}): Finding {
  const f: Finding = {
    id: `f${++n}`,
    anchors: [],
    categoryId: "logic",
    severity: "medium",
    title: "绝对化措辞",
    quote: "四天工作制已经被充分验证",
    problem: "「被充分验证」语气过强，与前文单案例论据不匹配。",
    reason: "绝对化措辞会让读者立即寻找反例。",
    suggestion: "改为「在部分公司显示出积极信号」。",
    anchorStatus: "unanchored",
    ...over,
  };
  return f.anchors.length > 0 ? f : withAnchors(f);
}

describe("同类明显重复被合并", () => {
  it("quote 相同 + 标题相同 + problem 高度相似 → 合并为一条", () => {
    const a = mk();
    const b = mk({ problem: "「被充分验证」语气过强，与文中单一案例论据不匹配。" });
    const out = dedupFindings([a, b], "逻辑");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(a.id);
  });

  it("quote 相同但问题不同（标题不同）→ 保留两条", () => {
    const a = mk();
    const b = mk({ title: "结论扩大", problem: "结论超出了论据支持的范围。" });
    const out = dedupFindings([a, b], "逻辑");
    expect(out).toHaveLength(2);
  });
});

describe("跨类相似不合并", () => {
  it("同 quote 同标题但类别不同 → 两条都保留", () => {
    const a = mk({ categoryId: "logic" });
    const b = mk({ categoryId: "rhetoric" });
    const out = dedupFindings([a, b], "混合");
    expect(out).toHaveLength(2);
  });
});

describe("相似度函数", () => {
  it("完全相同为 1；无关文本接近 0", () => {
    expect(similarity("前文信息不足", "前文信息不足")).toBe(1);
    expect(similarity("前文信息不足", "今天天气很好")).toBeLessThan(0.2);
  });
});
