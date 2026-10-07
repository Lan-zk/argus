// uiStore（review-versioning design D7）：顶层两入口（审阅 / 设置）+ 审阅区内部下钻视图。

import { defineStore } from "pinia";
import type { Severity } from "../domain/types";
import { useSettingsStore } from "./settings";

export type PageId = "review" | "settings";
/** 审阅区主区视图：新一轮输入 / 工作台（项目列表常驻左侧栏，可折叠）。 */
export type ReviewView = "new" | "workspace";

export const useUiStore = defineStore("ui", {
  state: () => ({
    page: "review" as PageId,
    reviewView: "workspace" as ReviewView,
    /** 左侧审阅列表折叠状态（持久化于 ui 偏好）。 */
    sidebarCollapsed: false,
    selectedFindingId: null as string | null,
    hoverFindingId: null as string | null,
    filterCategory: "all" as string,
    filterSeverity: "all" as Severity | "all",
    sideTab: "findings" as "findings" | "report" | "compare",
  }),

  actions: {
    go(page: PageId) {
      this.page = page;
    },
    goReview(view: ReviewView) {
      this.page = "review";
      this.reviewView = view;
    },
    selectFinding(id: string | null) {
      this.selectedFindingId = id;
    },
    hoverFinding(id: string | null) {
      this.hoverFindingId = id;
    },
    setFilterCategory(id: string) {
      this.filterCategory = id;
    },
    setFilterSeverity(s: Severity | "all") {
      this.filterSeverity = s;
    },
    setSideTab(tab: "findings" | "report" | "compare") {
      this.sideTab = tab;
    },
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      void useSettingsStore().setSidebarCollapsed(this.sidebarCollapsed);
    },
    resetFilters() {
      this.filterCategory = "all";
      this.filterSeverity = "all";
    },
  },
});
