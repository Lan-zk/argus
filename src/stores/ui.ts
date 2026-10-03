// uiStore（design 决策 2）：当前页、选中 Finding、双筛选、右栏 tab、hover 联动。

import { defineStore } from "pinia";
import type { Severity } from "../domain/types";

export type PageId = "new" | "workspace" | "settings";

export const useUiStore = defineStore("ui", {
  state: () => ({
    page: "new" as PageId,
    selectedFindingId: null as string | null,
    hoverFindingId: null as string | null,
    filterCategory: "all" as string,
    filterSeverity: "all" as Severity | "all",
    sideTab: "findings" as "findings" | "report",
  }),

  actions: {
    go(page: PageId) {
      this.page = page;
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
    setSideTab(tab: "findings" | "report") {
      this.sideTab = tab;
    },
    resetFilters() {
      this.filterCategory = "all";
      this.filterSeverity = "all";
    },
  },
});
