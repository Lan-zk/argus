// spec: theme-system —— 主题应用与跟随系统实时切换（design D2）。
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useThemeStore } from "./theme";
import { useSettingsStore } from "./settings";

beforeEach(() => {
  setActivePinia(createPinia());
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
});

describe("主题应用", () => {
  it("start 后按默认偏好（swiss/system/系统亮色）写入 data-theme 与 color-scheme", () => {
    useThemeStore().start();
    expect(document.documentElement.dataset.theme).toBe("swiss-light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("system 模式下系统明暗翻转时实时切换（spec: 跟随系统实时切换）", () => {
    const t = useThemeStore();
    t.start();
    t.setSystemDark(true);
    expect(document.documentElement.dataset.theme).toBe("swiss-dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("偏好切换即时生效：apple + dark", () => {
    useThemeStore().start();
    const s = useSettingsStore();
    s.ui.theme = "apple";
    s.ui.appearance = "dark";
    expect(document.documentElement.dataset.theme).toBe("apple-dark");
  });

  it("显式明暗优先于系统：appearance=light 时系统暗色不生效", () => {
    const t = useThemeStore();
    t.start();
    const s = useSettingsStore();
    s.ui.appearance = "light";
    t.setSystemDark(true);
    expect(document.documentElement.dataset.theme).toBe("swiss-light");
  });
});
