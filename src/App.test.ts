// spec: review-ui 三页骨架：顶部导航 + 页面切换（tasks 1.4）
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import App from "./App.vue";
import { useUiStore } from "./stores/ui";

describe("三页骨架", () => {
  it("顶部导航三个 tab 可切换三页", async () => {
    setActivePinia(createPinia());
    const w = mount(App, { global: { plugins: [createPinia()] } });
    const ui = useUiStore();
    expect(ui.page).toBe("new");

    const tabs = w.findAll(".navtab");
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.text().replace(/\s+/g, ""))).toEqual(["01新建审阅", "02审阅工作台", "03设置"]);

    await tabs[2].trigger("click");
    expect(ui.page).toBe("settings");
    expect(w.find(".set-wrap").exists()).toBe(true);

    await tabs[1].trigger("click");
    expect(ui.page).toBe("workspace");
    expect(w.find(".page-ws").exists()).toBe(true);

    await tabs[0].trigger("click");
    expect(ui.page).toBe("new");
    expect(w.find(".new-wrap").exists()).toBe(true);

    // 当前 tab 高亮
    expect(tabs[0].classes()).toContain("on");
    w.unmount();
  });
});
