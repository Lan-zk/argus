// spec: review-ui 只读原文渲染 + 高亮切片 + 重叠叠加 + unanchored 无高亮
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import DocViewer from "./DocViewer.vue";
import { parseBlocks } from "../domain/parser";
import { anchorOne } from "../domain/anchor";
import type { Finding } from "../domain/types";

const DOC = "# 标题\n\n这是第一段，包含目标语句供定位。\n\n> 引用块内容\n\n- 列表项\n\n```\ncode line\n```";
const blocks = parseBlocks(DOC);

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    categoryId: "logic",
    severity: "high",
    title: "推理跳跃",
    quote: "目标语句",
    problem: "p",
    reason: "r",
    suggestion: "s",
    anchorStatus: "unanchored",
    ...over,
  };
}

function colorMap(): Record<string, string> {
  return { logic: "#ff0000", rhetoric: "#00ff00" };
}

describe("渲染保留结构（spec: 只读原文渲染）", () => {
  it("标题/引用/列表/代码按对应元素渲染并显示行号", () => {
    const w = mount(DocViewer, {
      props: { blocks, findings: [], colorMap: colorMap() },
    });
    expect(w.find("h1").classes()).toContain("b-heading1");
    expect(w.find("blockquote").exists()).toBe(true);
    expect(w.find(".b-list_item").exists()).toBe(true);
    expect(w.find("pre").exists()).toBe(true);
    const ids = w.findAll(".bid").map((b) => b.text());
    expect(ids[0]).toContain("L1");
    expect(ids).toHaveLength(blocks.length);
  });
});

describe("块定位锚点属性（spec: 高亮与双向定位 · 点卡片滚动到原文）", () => {
  it("每个渲染块输出 data-block-id，供卡片定位查找原文块", () => {
    const w = mount(DocViewer, {
      props: { blocks, findings: [], colorMap: colorMap() },
    });
    const withAttr = w.findAll("[data-block-id]");
    expect(withAttr).toHaveLength(blocks.length);
    expect(withAttr.map((el) => el.attributes("data-block-id"))).toEqual(blocks.map((b) => b.id));
  });
});

describe("高亮落点来自定位算法（spec: 定位基准为块模型）", () => {
  it("anchored Finding 在对应文本区间显示高亮切片，其他文本不受影响", () => {
    const anchored = anchorOne(finding({ quote: "目标语句" }), blocks, "逻辑");
    expect(anchored.anchorStatus).toBe("anchored");
    const w = mount(DocViewer, {
      props: { blocks, findings: [anchored], colorMap: colorMap() },
    });
    const hls = w.findAll(".hl");
    expect(hls).toHaveLength(1);
    expect(hls[0].text()).toBe("目标语句");
    expect(hls[0].classes()).toContain("u1");
    // 区间两侧的正常切片存在
    expect(w.find(".docbody").text()).toContain("这是第一段，包含");
  });

  it("unanchored Finding 不产生高亮", () => {
    const un = finding({ quote: "不存在的引用", anchorStatus: "unanchored" });
    const w = mount(DocViewer, {
      props: { blocks, findings: [un], colorMap: colorMap() },
    });
    expect(w.findAll(".hl")).toHaveLength(0);
  });
});

describe("重叠 Finding 支持（spec: 同句多问题）", () => {
  it("同一文本两条 Finding 叠加为多层下划线，颜色可区分", () => {
    const a = anchorOne(finding({ id: "fa", quote: "目标语句" }), blocks, "逻辑");
    const b = anchorOne(finding({ id: "fb", categoryId: "rhetoric", quote: "包含目标语句供定位" }), blocks, "修辞");
    const w = mount(DocViewer, {
      props: { blocks, findings: [a, b], colorMap: colorMap() },
    });
    const hls = w.findAll(".hl");
    expect(hls.length).toBeGreaterThanOrEqual(2);
    // 内层区间（目标语句）同时被两条命中 → u2 叠加
    const inner = hls.find((h) => h.text() === "目标语句")!;
    expect(inner.classes()).toContain("u2");
    const style = inner.attributes("style") ?? "";
    expect(style).toContain("--u1");
    expect(style).toContain("--u2");
  });

  it("点击高亮触发 highlight-click 携带全部 finding id；选中态正确", async () => {
    const a = anchorOne(finding({ id: "fa", quote: "目标语句" }), blocks, "逻辑");
    const b = anchorOne(finding({ id: "fb", categoryId: "rhetoric", quote: "目标语句" }), blocks, "修辞");
    const w = mount(DocViewer, {
      props: { blocks, findings: [a, b], colorMap: colorMap(), selectedFindingId: "fa" },
    });
    const inner = w.findAll(".hl").find((h) => h.text() === "目标语句")!;
    await inner.trigger("click");
    const ev = w.emitted("highlight-click");
    expect(ev).toBeTruthy();
    expect((ev![0][0] as string[]).sort()).toEqual(["fa", "fb"]);
    expect(inner.classes()).toContain("sel");
  });
});

describe("文档内链接安全（安全审计回归：外链交系统打开，不进入 WebView 导航）", () => {
  it("https 链接渲染为锚点；点击被拦截并经 window.open 外开（非 Tauri 环境）", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const doc = "参见 [官方文档](https://example.com/guide)。\n\n正文说明。";
    const w = mount(DocViewer, {
      props: { blocks: parseBlocks(doc), findings: [], colorMap: {} },
    });
    const a = w.find("a");
    expect(a.exists()).toBe(true);
    await a.trigger("click");
    expect(openSpy).toHaveBeenCalledWith("https://example.com/guide", "_blank", "noopener,noreferrer");
    openSpy.mockRestore();
  });
});
