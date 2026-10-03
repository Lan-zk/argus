// themeStore（spec: theme-system / design D2）：持有系统明暗，把双轴偏好解析结果应用到 <html>。
// matchMedia 全局仅此一处监听；偏好本身持久化在 settingsStore（ui.theme / ui.appearance）。

import { defineStore } from "pinia";
import { watchEffect } from "vue";
import { applyTheme, resolveTheme } from "../lib/theme";
import { useSettingsStore } from "./settings";

export const useThemeStore = defineStore("theme", {
  state: () => ({
    /** 操作系统当前是否暗色（matchMedia 解析结果）。 */
    systemDark: false,
    started: false,
  }),
  actions: {
    setSystemDark(v: boolean) {
      this.systemDark = v;
    },

    /** 启动响应式应用与系统明暗监听；main.ts 在 mount 前调用一次，幂等。 */
    start() {
      if (this.started) return;
      this.started = true;
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      this.setSystemDark(mql.matches);
      mql.addEventListener("change", (e) => this.setSystemDark(e.matches));
      // flush:"sync"：偏好或系统明暗一变立即写属性，不产生中间帧
      watchEffect(
        () => {
          const { theme, appearance } = useSettingsStore().ui;
          applyTheme(resolveTheme(theme, appearance, this.systemDark));
        },
        { flush: "sync" },
      );
    },
  },
});
