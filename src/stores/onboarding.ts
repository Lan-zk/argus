// onboardingStore（spec: onboarding / design D3）：引导层的开关与落点。
// 粘性标记本体持久化在 settingsStore（ui.onboarded）；本 store 只持有 active 与返回页。

import { defineStore } from "pinia";
import { useSettingsStore } from "./settings";
import { useUiStore } from "./ui";
import type { PageId } from "./ui";

export const useOnboardingStore = defineStore("onboarding", {
  state: () => ({
    /** 引导层是否显示（App 根级 v-if）。 */
    active: false,
    /** 进入引导前所在页（skip 的落点）。 */
    returnPage: "review" as PageId,
  }),

  actions: {
    /** 打开引导（幂等）：记录当前页为返回页。首启自动进入与手动重看共用。 */
    start() {
      if (this.active) return;
      this.returnPage = useUiStore().page;
      this.active = true;
    },

    /** 首启判定（design D3 双检）：设置已加载、标记未置位、未在引导中。
     *  App setup 同步调用（主路径首帧零闪烁）+ onMounted init 后再调（测试直挂兜底）。 */
    maybeAutoStart() {
      const settings = useSettingsStore();
      if (settings.loaded && !settings.ui.onboarded && !this.active) this.start();
    },

    /** 完成：置位标记 → 关层 → 落「审阅 · 新一轮输入」（新建项目首轮）。由引导组件在 addModel 成功后调用。 */
    async complete() {
      await useSettingsStore().setOnboarded(true);
      this.active = false;
      useUiStore().goReview("new");
    },

    /** 跳过：置位标记 → 关层 → 回到进入前页面。 */
    async skip() {
      await useSettingsStore().setOnboarded(true);
      this.active = false;
      useUiStore().go(this.returnPage);
    },
  },
});
