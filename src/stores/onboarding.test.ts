// spec: onboarding 跳过与完成语义 / design D3 状态机与双检。
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useOnboardingStore } from "./onboarding";
import { useSettingsStore } from "./settings";
import { useUiStore } from "./ui";
import { defaultSettings, loadState, saveSettings } from "../lib/persistence";

beforeEach(async () => {
  setActivePinia(createPinia());
  await saveSettings(defaultSettings()); // 复位内存兜底存储，隔离同文件用例间的持久化污染
});

describe("onboarding store 状态机", () => {
  it("start 幂等并记录返回页", () => {
    const onb = useOnboardingStore();
    const ui = useUiStore();
    ui.go("settings");
    onb.start();
    expect(onb.active).toBe(true);
    expect(onb.returnPage).toBe("settings");
    ui.goReview("new");
    onb.start(); // 已 active：不覆盖返回页
    expect(onb.returnPage).toBe("settings");
  });

  it("complete：置位标记、关层、落「新建审阅」", async () => {
    const onb = useOnboardingStore();
    const settings = useSettingsStore();
    const ui = useUiStore();
    await settings.init();
    ui.go("settings");
    onb.start();
    await onb.complete();
    expect(onb.active).toBe(false);
    expect(ui.reviewView).toBe("new");
    expect((await loadState()).settings.ui.onboarded).toBe(true);
  });

  it("skip：置位标记、关层、回原页", async () => {
    const onb = useOnboardingStore();
    const settings = useSettingsStore();
    const ui = useUiStore();
    await settings.init();
    ui.go("settings");
    onb.start();
    await onb.skip();
    expect(onb.active).toBe(false);
    expect(ui.page).toBe("settings");
    expect((await loadState()).settings.ui.onboarded).toBe(true);
  });
});

describe("maybeAutoStart 三条件（design D3 双检）", () => {
  it("设置未加载不弹 → 加载且未置位弹 → 置位后不再弹", async () => {
    const onb = useOnboardingStore();
    const settings = useSettingsStore();
    onb.maybeAutoStart(); // loaded=false：不判定
    expect(onb.active).toBe(false);

    await settings.init(); // 全新数据 onboarded=false
    onb.maybeAutoStart();
    expect(onb.active).toBe(true);

    onb.active = false;
    await settings.setOnboarded(true);
    onb.maybeAutoStart();
    expect(onb.active).toBe(false);
  });
});
