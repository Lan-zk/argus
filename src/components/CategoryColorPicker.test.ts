// spec: settings 类别颜色配置 —— 取色弹层（category-colors tasks 2.1）。
import { describe, expect, it, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import CategoryColorPicker from "./CategoryColorPicker.vue";

beforeEach(() => {
  // 注入当前皮肤底色，供低对比校验读取（无样式环境下组件会跳过校验）
  document.documentElement.style.setProperty("--paper", "#f5f5f7");
  document.documentElement.style.setProperty("--card", "#ffffff");
  document.documentElement.style.setProperty("--hair", "1px solid #e0e0e0");
});

describe("CategoryColorPicker", () => {
  it("渲染 10 个策展色板项，点击回写 var(--pN) 并关闭", async () => {
    const w = mount(CategoryColorPicker, { props: { modelValue: "var(--gray)" } });
    const swatches = w.findAll(".ccp-sw");
    expect(swatches).toHaveLength(10);
    await swatches[2].trigger("click");
    expect(w.emitted("select")![0]).toEqual(["var(--p3)"]);
    expect(w.emitted("close")).toBeTruthy();
    w.unmount();
  });

  it("当前色命中色板项时该项带选中态", () => {
    const w = mount(CategoryColorPicker, { props: { modelValue: "var(--p1)" } });
    expect(w.find(".ccp-sw.on").attributes("aria-label")).toBe("绿");
    w.unmount();
  });

  it("自定义低对比色显示 ⚠ 提示且仍可应用（spec: 自定义色值低对比提示）", async () => {
    const w = mount(CategoryColorPicker, { props: { modelValue: "var(--gray)" } });
    const input = w.find('input[type="color"]');
    // #f2f2f2 对 #f5f5f7/#ffffff 均低于 3:1
    (input.element as HTMLInputElement).value = "#f2f2f2";
    await input.trigger("input");
    expect(w.find(".ccp-warn").exists()).toBe(true);
    const events = w.emitted("select")!;
    expect(events[events.length - 1]).toEqual(["#f2f2f2"]);
    w.unmount();
  });

  it("自定义高对比色不出现提示", async () => {
    const w = mount(CategoryColorPicker, { props: { modelValue: "var(--gray)" } });
    const input = w.find('input[type="color"]');
    (input.element as HTMLInputElement).value = "#1d1d1f";
    await input.trigger("input");
    expect(w.find(".ccp-warn").exists()).toBe(false);
    w.unmount();
  });

  it("Esc 触发关闭事件", async () => {
    const w = mount(CategoryColorPicker, { props: { modelValue: "var(--gray)" } });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(w.emitted("close")).toBeTruthy();
    w.unmount();
  });
});
