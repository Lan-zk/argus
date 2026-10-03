// settingsStore（design 决策 2）：模型配置、类别、草稿文本、UI 偏好。
// 持久化透明自动：任何变更即落盘（模型配置脱敏，Key 进钥匙串）。

import { defineStore } from "pinia";
import type { ModelConfig, ProviderKind, ReviewCategory } from "../domain/types";
import { DEFAULT_CATEGORIES } from "../domain/default-categories";
import { keyring } from "../lib/keyring";
import { defaultSettings, loadState, saveSettings } from "../lib/persistence";

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useSettingsStore = defineStore("settings", {
  state: () => ({
    models: [] as ModelConfig[],
    categories: [] as ReviewCategory[],
    draftText: "",
    ui: { splitPercent: 60 },
    /** 恢复提示条（最近一次 Review）。 */
    restored: false,
    lastReview: null as Awaited<ReturnType<typeof loadState>>["lastReview"],
    loaded: false,
  }),

  getters: {
    enabledCategories: (s) => s.categories.filter((c) => c.enabled).sort((a, b) => a.order - b.order),
    defaultModel: (s): ModelConfig | null => s.models.find((m) => m.isDefault) ?? s.models[0] ?? null,
    defaultSelectedIds: (s) => s.categories.filter((c) => c.enabled && c.defaultSelected).map((c) => c.id),
    categoryById: (s) => (id: string) => s.categories.find((c) => c.id === id),
  },

  actions: {
    async init() {
      const state = await loadState();
      this.models = state.settings.models;
      this.categories = state.settings.categories;
      this.draftText = state.settings.draftText;
      this.ui = state.settings.ui;
      this.lastReview = state.lastReview;
      this.loaded = true;
    },

    async persist() {
      await saveSettings({
        models: this.models,
        categories: this.categories,
        draftText: this.draftText,
        ui: this.ui,
      });
    },

    // ---- Models CRUD（spec: settings 模型配置管理）----
    async addModel(input: Omit<ModelConfig, "id">): Promise<ModelConfig> {
      const cfg: ModelConfig = { ...input, id: uid("m") };
      if (cfg.apiKey) {
        await keyring.set(cfg.id, cfg.apiKey);
        cfg.keyringRef = cfg.id;
      }
      if (this.models.length === 0) cfg.isDefault = true;
      this.models.push(cfg);
      await this.persist();
      return cfg;
    },

    async updateModel(id: string, patch: Partial<ModelConfig>): Promise<void> {
      const m = this.models.find((x) => x.id === id);
      if (!m) return;
      Object.assign(m, patch);
      if (patch.apiKey !== undefined && patch.apiKey !== "") {
        await keyring.set(m.id, patch.apiKey);
        m.keyringRef = m.id;
      }
      await this.persist();
    },

    async deleteModel(id: string): Promise<void> {
      const wasDefault = this.models.find((m) => m.id === id)?.isDefault;
      this.models = this.models.filter((m) => m.id !== id);
      await keyring.delete(id);
      if (wasDefault && this.models[0]) this.models[0].isDefault = true;
      await this.persist();
    },

    async setDefaultModel(id: string): Promise<void> {
      for (const m of this.models) m.isDefault = m.id === id;
      await this.persist();
    },

    /** 运行时短路径读取 Key（注入调用参数，不缓存）。 */
    async getApiKey(cfg: ModelConfig): Promise<string> {
      if (cfg.apiKey) return cfg.apiKey;
      return (await keyring.get(cfg.id)) ?? "";
    },

    // ---- Categories CRUD（spec: settings Review Category 管理）----
    async addCategory(input: Partial<ReviewCategory>): Promise<ReviewCategory> {
      const cat: ReviewCategory = {
        id: uid("cat"),
        name: input.name ?? "新类别",
        description: input.description ?? "",
        color: input.color ?? "var(--gray)",
        prompt: input.prompt ?? "你是文稿审阅专家。请描述本类别的检查项。",
        enabled: input.enabled ?? true,
        defaultSelected: input.defaultSelected ?? false,
        order: this.categories.length,
      };
      this.categories.push(cat);
      await this.persist();
      return cat;
    },

    async updateCategory(id: string, patch: Partial<ReviewCategory>): Promise<void> {
      const c = this.categories.find((x) => x.id === id);
      if (!c) return;
      Object.assign(c, patch);
      await this.persist();
    },

    async deleteCategory(id: string): Promise<void> {
      this.categories = this.categories.filter((c) => c.id !== id);
      await this.persist();
    },

    /** 复制类别：Prompt 相同、名称标副本、原类别不变（spec: settings 复制类别场景）。 */
    async duplicateCategory(id: string): Promise<void> {
      const src = this.categories.find((c) => c.id === id);
      if (!src) return;
      this.categories.push({
        ...structuredClone(src),
        id: uid("cat"),
        name: `${src.name}副本`,
        order: this.categories.length,
      });
      await this.persist();
    },

    /** 顺序调整（上移/下移）。 */
    async moveCategory(id: string, dir: -1 | 1): Promise<void> {
      const sorted = [...this.categories].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((c) => c.id === id);
      const swapWith = idx + dir;
      if (idx < 0 || swapWith < 0 || swapWith >= sorted.length) return;
      const a = sorted[idx];
      const b = sorted[swapWith];
      const tmp = a.order;
      a.order = b.order;
      b.order = tmp;
      await this.persist();
    },

    async setDraftText(text: string): Promise<void> {
      this.draftText = text;
      await this.persist();
    },

    async setSplitPercent(p: number): Promise<void> {
      this.ui.splitPercent = Math.round(p);
      await this.persist();
    },

    async resetDraft(): Promise<void> {
      this.draftText = "";
      await this.persist();
    },

    restoreDefaultsIfEmpty() {
      if (this.categories.length === 0) this.categories = structuredClone(DEFAULT_CATEGORIES);
    },

    defaults() {
      return defaultSettings();
    },
  },
});

export type ProviderOption = ProviderKind;
