// spec: review-ui Finding 卡片内容（七要素、无状态按钮、unanchored 标注）
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import FindingCard from "./FindingCard.vue";
import type { Finding } from "../domain/types";

function mk(over: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    categoryId: "logic",
    severity: "high",
    title: "推理跳跃",
    quote: "因此这个商业模式已经被验证",
    problem: "前文信息不足。",
    reason: "用户增长不能证明商业模式成立。",
    suggestion: "降低结论强度。",
    anchorStatus: "anchored",
    line: 19,
    ...over,
  };
}

describe("卡片字段完整（spec: 卡片字段完整场景）", () => {
  it("显示 Category、Severity、标题、原文、问题、原因、建议；无状态按钮", () => {
    const w = mount(FindingCard, {
      props: {
        finding: mk(),
        categoryName: "逻辑",
        categoryColor: "#e2231a",
      },
    });
    const text = w.text();
    expect(text).toContain("逻辑");
    expect(text).toContain("严重");
    expect(text).toContain("推理跳跃");
    expect(text).toContain("因此这个商业模式已经被验证");
    expect(text).toContain("前文信息不足。");
    expect(text).toContain("用户增长不能证明商业模式成立。");
    expect(text).toContain("降低结论强度。");
    // 无 Accept/Reject/Resolved 状态操作
    expect(w.findAll("button")).toHaveLength(0);
    expect(text).not.toContain("接受");
    expect(text).not.toContain("忽略");
    // L 行号显示
    expect(w.find(".bidref").text()).toBe("L19");
  });

  it("severity 样式分级可识别；unanchored 显示未定位标注与虚线样式", () => {
    const w = mount(FindingCard, {
      props: { finding: mk({ anchorStatus: "unanchored", severity: "low" }), categoryName: "修辞", categoryColor: "#7444c1" },
    });
    expect(w.find(".sev").classes()).toContain("low");
    expect(w.find(".unb").text()).toBe("未定位");
    expect(w.find(".card").classes()).toContain("unanchored");
  });

  it("点击卡片触发 select；hover 触发 hover 事件", async () => {
    const w = mount(FindingCard, {
      props: { finding: mk(), categoryName: "逻辑", categoryColor: "#e2231a" },
    });
    await w.find(".card").trigger("click");
    expect(w.emitted("select")![0]).toEqual(["f1"]);
    await w.find(".card").trigger("mouseenter");
    expect(w.emitted("hover")![0]).toEqual(["f1"]);
    await w.find(".card").trigger("mouseleave");
    expect(w.emitted("hover")![1]).toEqual([null]);
  });
});
