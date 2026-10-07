// spec: settings-in-sidebar 侧栏 chrome：无全局顶栏，账户行菜单进设置 / 返回审阅
// spec: onboarding 首次运行判定：首启弹层 / 置位不弹 / 侧栏保留 DOM
import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import App from "./App.vue";
import { useUiStore } from "./stores/ui";
import { useSettingsStore } from "./stores/settings";
import { useSessionStore } from "./stores/session";
import { defaultSettings, saveSettings } from "./lib/persistence";
import { getRepo, resetRepoForTests } from "./lib/repo";

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

describe("侧栏 chrome 外壳", () => {
  it("无全局顶栏；账户行菜单进入设置页，返回审阅回到工作台", async () => {
    const w = await mountApp({ onboarded: true });
    const ui = useUiStore();
    expect(ui.page).toBe("review");

    // 侧栏 = chrome：无 navtab 顶栏，侧栏 + 工作台在位
    expect(w.find(".navtab").exists()).toBe(false);
    expect(w.find("nav").exists()).toBe(false);
    expect(w.find(".psb").exists()).toBe(true);
    expect(w.find(".page-ws").exists()).toBe(true);

    // 账户行菜单 → 设置
    await w.find(".psb-acct").trigger("click");
    const items = w.findAll(".pop-item");
    expect(items.length).toBeGreaterThanOrEqual(3);
    const setItem = items.find((i) => i.text().includes("设置"));
    expect(setItem).toBeTruthy();
    await setItem!.trigger("click");
    expect(ui.page).toBe("settings");
    expect(w.find(".set-wrap").exists()).toBe(true);
    expect(w.find(".psb-acct.on").exists()).toBe(true); // 设置期间账户行激活

    // 页头「返回审阅」
    await w.find(".set-head button").trigger("click");
    expect(ui.page).toBe("review");
    expect(w.find(".page-ws").exists()).toBe(true);
    w.unmount();
  });

  it("两页渲染文案不含开发侧信息（MVP/PRD/§）（spec: review-ui 文案面向使用者）", async () => {
    const w = await mountApp({ onboarded: true });
    const ui = useUiStore();
    for (const page of ["review", "settings"] as const) {
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
  it("onboarded 未置位：App 挂载后出现引导层；侧栏 chrome 保留 DOM（断言兼容）", async () => {
    await saveSettings(defaultSettings()); // 全新数据（onboarded=false）
    const pinia = createPinia();
    setActivePinia(pinia);
    const w = mount(App, { global: { plugins: [pinia] } });
    // setup 双检之一：设置未加载不判定（测试直挂路径），此刻无层
    expect(w.find(".ob-layer").exists()).toBe(false);
    await flushPromises(); // onMounted init → 双检之二 → 弹层
    expect(w.find(".ob-layer").exists()).toBe(true);
    expect(w.find(".psb-acct").exists()).toBe(true);
    w.unmount();
  });

  it("onboarded 已置位：不出现引导层", async () => {
    const w = await mountApp({ onboarded: true });
    expect(w.find(".ob-layer").exists()).toBe(false);
    w.unmount();
  });
});

describe("重启恢复（spec: app-persistence 恢复审阅工作区——回到最后轮次 MUST 有明确提示）", () => {
  const NOW = "2026-10-05T12:00:00.000Z";

  async function seedLastRound() {
    resetRepoForTests();
    const repo = getRepo();
    await repo.insertProject({ id: "rp1", name: "恢复项目", createdAt: NOW, updatedAt: NOW });
    await repo.insertRound({
      id: "rr1", projectId: "rp1", number: 1, status: "completed",
      categorySnapshot: [], modelSnapshot: {}, createdAt: NOW,
    });
    await repo.insertDocument({ id: "rd1", roundId: "rr1", text: "# 标题\n\n正文", createdAt: NOW });
    await repo.setPref("lastActive", { projectId: "rp1", roundId: "rr1" });
  }

  it("有最后活动轮次：回到工作台并显示恢复提示条（含「新建审阅」直达入口）", async () => {
    await seedLastRound();
    const w = await mountApp({ onboarded: true });
    const ui = useUiStore();
    const session = useSessionStore();
    expect(ui.reviewView).toBe("workspace"); // 回到最后轮次工作台
    expect(session.showRestoreBanner).toBe(true); // 明确提示（此前仅未完成轮次显示——用户报告静默跳转）
    expect(w.find('[data-test="restore-banner"]').text()).toContain("已打开上次所在轮次");
    // 想导入/粘贴新文稿的用户：提示条直达新建审阅
    await w.find('[data-test="restore-new-review"]').trigger("click");
    expect(ui.reviewView).toBe("new");
    w.unmount();
  });

  it("无历史轮次：不显示恢复提示", async () => {
    resetRepoForTests();
    const w = await mountApp({ onboarded: true });
    expect(useSessionStore().showRestoreBanner).toBe(false);
    w.unmount();
  });
});
