// settingsStore（design 决策 2）：模型配置、类别、草稿文本、UI 偏好。
// 持久化透明自动：任何变更即落盘（模型配置脱敏，Key 进钥匙串）。

import { defineStore } from "pinia";
import type { Appearance, ModelConfig, ProviderKind, ReviewCategory, ThemeStyle } from "../domain/types";
import { DEFAULT_CATEGORIES } from "../domain/default-categories";
import { rotationColor } from "../domain/palette";
import { keyring } from "../lib/keyring";
import { presetById } from "../domain/presets";
import { defaultSettings, loadState, saveSettings } from "../lib/persistence";

/** 内置类别 id 集合：兜底色轮转按「自定义类别数」计数（category-colors design D5）。 */
const BUILTIN_IDS = new Set(DEFAULT_CATEGORIES.map((c) => c.id));

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 查找同 Provider 已有配置存入钥匙串的 Key（按配置顺序取第一个命中）。 */
async function existingKeyFor(models: ModelConfig[], provider: string): Promise<string | null> {
  // 仅预设 Provider 可复用：服务身份唯一（api.deepseek.com 等）。
  // 自定义家族（尤其 openai-compatible）不同端点是不同服务，复用会把 Key 泄给无关端点。
  if (!presetById(provider)) return null;
  for (const m of models) {
    if (m.provider !== provider) continue;
    const key = await keyring.get(m.id);
    if (key) return key;
  }
  return null;
}

export const useSettingsStore = defineStore("settings", {
  state: () => ({
    models: [] as ModelConfig[],
    categories: [] as ReviewCategory[],
    draftText: "",
    ui: { splitPercent: 60, theme: "swiss" as ThemeStyle, appearance: "system" as Appearance, onboarded: false },
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
      if (this.loaded) return; // 幂等：main.ts 已在 mount 前初始化（theme-system 首帧），组件再调不重复读盘
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

    // ---- 主题偏好（spec: theme-system 偏好持久化与默认值）----
    async setTheme(theme: ThemeStyle) {
      this.ui.theme = theme;
      await this.persist();
    },

    async setAppearance(appearance: Appearance) {
      this.ui.appearance = appearance;
      await this.persist();
    },

    // ---- Onboarding 粘性标记（spec: onboarding 首次运行判定）----
    async setOnboarded(v: boolean) {
      this.ui.onboarded = v;
      await this.persist();
    },

    // ---- Models CRUD（spec: settings 模型配置管理）----
    async addModel(input: Omit<ModelConfig, "id">): Promise<ModelConfig> {
      const cfg: ModelConfig = { ...input, id: uid("m") };
      if (!cfg.apiKey && cfg.provider) {
        // 同 Provider 复用：把已存 Key 复制到新配置条目，避免删除旧配置影响新配置
        cfg.apiKey = (await existingKeyFor(this.models, cfg.provider)) ?? undefined;
      }
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

    /** 运行时短路径读取 Key（注入调用参数，不缓存）。回退链：内存 → 本配置钥匙串条目 → 同 Provider 兄弟配置（Key 复用）。 */
    async getApiKey(cfg: ModelConfig): Promise<string> {
      if (cfg.apiKey) return cfg.apiKey;
      const own = await keyring.get(cfg.id);
      if (own) return own;
      const sibling = await existingKeyFor(this.models, cfg.provider);
      return sibling ?? "";
    },

    /** 该 Provider 是否已有可复用的 Key（spec: settings 同 Provider 复用 Key）。 */
    async reusableKey(provider: string): Promise<string | null> {
      return existingKeyFor(this.models, provider);
    },

    // ---- Categories CRUD（spec: settings Review Category 管理）----
    async addCategory(input: Partial<ReviewCategory>): Promise<ReviewCategory> {
      const cat: ReviewCategory = {
        id: uid("cat"),
        name: input.name ?? "新类别",
        description: input.description ?? "",
        color: input.color ?? rotationColor(this.categories.filter((c) => !BUILTIN_IDS.has(c.id)).length),
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
