// spec: review-ui 三页骨架：顶部导航 + 页面切换（tasks 1.4）
// spec: onboarding 首次运行判定：首启弹层 / 置位不弹 / nav 保留 DOM（tasks 3.1/4.1）
import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import App from "./App.vue";
import { useUiStore } from "./stores/ui";
import { useSettingsStore } from "./stores/settings";
import { defaultSettings, saveSettings } from "./lib/persistence";

/** 挂载 App：active pinia 与组件 plugin pinia 同一实例（断言落在同一 store）。 */
async function mountApp(opts?: { onboarded?: boolean }) {
  const pinia = createPinia();
  setActivePinia(pinia);
  if (opts?.onboarded !== undefined) {
    // 预置持久化标记并加载，隔离既有断言（spec: onboarding App 测试兼容）
    const data = defaultSettings();
    data.ui.onboarded = opts.onboarded;
    await saveSettings(data);
    await useSettingsStore().init();
  }
  const w = mount(App, { global: { plugins: [pinia] } });
  await flushPromises();
  return w;
}

describe("三页骨架", () => {
  it("顶部导航三个 tab 可切换三页", async () => {
    const w = await mountApp({ onboarded: true });
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

  it("三页渲染文案不含开发侧信息（MVP/PRD/§）（spec: review-ui 文案面向使用者）", async () => {
    const w = await mountApp({ onboarded: true });
    const ui = useUiStore();
    for (const page of ["new", "workspace", "settings"] as const) {
      ui.go(page);
      await new Promise((r) => setTimeout(r, 0));
      const text = document.body.textContent ?? "";
      for (const kw of ["MVP", "PRD", "§"]) {
        expect(text, `页面 ${page} 含开发侧信息「${kw}」`).not.toContain(kw);
      }
    }
    w.unmount();
  });
});

describe("首次运行引导挂载（spec: onboarding 首次运行判定与自动进入）", () => {
  it("onboarded 未置位：App 挂载后出现引导层；nav 保留 DOM（断言兼容）", async () => {
    await saveSettings(defaultSettings()); // 全新数据（onboarded=false）
    const pinia = createPinia();
    setActivePinia(pinia);
    const w = mount(App, { global: { plugins: [pinia] } });
    // setup 双检之一：设置未加载不判定（测试直挂路径），此刻无层
    expect(w.find(".ob-layer").exists()).toBe(false);
    await flushPromises(); // onMounted init → 双检之二 → 弹层
    expect(w.find(".ob-layer").exists()).toBe(true);
    expect(w.findAll(".navtab")).toHaveLength(3);
    w.unmount();
  });

  it("onboarded 已置位：不出现引导层", async () => {
    const w = await mountApp({ onboarded: true });
    expect(w.find(".ob-layer").exists()).toBe(false);
    w.unmount();
  });
});
