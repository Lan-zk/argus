// settingsStore（design 决策 2）：模型配置、类别、草稿文本、UI 偏好。
// 持久化透明自动：任何变更即落盘（模型配置脱敏，Key 进钥匙串）。

import { defineStore } from "pinia";
import type { Appearance, CategoryGroup, ModelConfig, ProviderKind, ReviewCategory, ThemeStyle, UiPrefs } from "../domain/types";
import { DEFAULT_CATEGORIES } from "../domain/default-categories";
import { rotationColor } from "../domain/palette";
import { keyring } from "../lib/keyring";
import { presetById } from "../domain/presets";
import { defaultSettings, isLegacyMigrationFailed, loadState, saveSettings } from "../lib/persistence";
import { getRepo } from "../lib/repo";
import { ReadOnlyStorageError } from "../lib/repo/types";
import { evictModelsCache } from "../ai/client";

/** 内置类别 id 集合：兜底色轮转按「自定义类别数」计数（category-colors design D5）。 */
const BUILTIN_IDS = new Set(DEFAULT_CATEGORIES.map((c) => c.id));

/** 分组视图项（design D5 统一 getter 输出）：「通用」虚拟组 id 为 null，恒在置顶。 */
export interface GroupView {
  id: string | null;
  name: string;
  order: number;
}

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
    /** 自定义类别分组（spec: settings 类别分组管理）——「通用」为虚拟组不入此列。 */
    groups: [] as CategoryGroup[],
    draftText: "",
    ui: { splitPercent: 60, theme: "swiss" as ThemeStyle, appearance: "system" as Appearance, onboarded: false, sidebarCollapsed: false } as UiPrefs,
    /** 恢复提示条（最近一次 Review）。 */
    restored: false,
    lastReview: null as Awaited<ReturnType<typeof loadState>>["lastReview"],
    loaded: false,
    /** 降级保护：库 schema 版本高于应用 → 只读（spec: app-persistence 存储迁移与版本兼容）。 */
    storageReadOnly: false,
    /** 旧数据首迁上次尝试失败（本次以现有数据运行，下次启动自动重试）。 */
    migrationFailed: false,
  }),

  getters: {
    enabledCategories: (s) => s.categories.filter((c) => c.enabled).sort((a, b) => a.order - b.order),
    defaultModel: (s): ModelConfig | null => s.models.find((m) => m.isDefault) ?? s.models[0] ?? null,
    defaultSelectedIds: (s) => s.categories.filter((c) => c.enabled && c.defaultSelected).map((c) => c.id),
    categoryById: (s) => (id: string) => s.categories.find((c) => c.id === id),
    /** 全部分组（design D5 统一序）：通用虚拟置顶 + 自定义组按 sort_order；设置页分节与 New Review 切换器共用。 */
    allGroups(s): GroupView[] {
      return [{ id: null, name: "通用", order: -1 }, ...[...s.groups].sort((a, b) => a.order - b.order)];
    },
  },

  actions: {
    async init() {
      if (this.loaded) return; // 幂等：main.ts 已在 mount 前初始化（theme-system 首帧），组件再调不重复读盘
      const state = await loadState();
      this.models = state.settings.models;
      this.categories = state.settings.categories;
      this.draftText = state.settings.draftText;
      this.ui = state.settings.ui;
      this.groups = await getRepo().listGroups();
      this.lastReview = state.lastReview;
      this.storageReadOnly = getRepo().readOnly;
      this.migrationFailed = isLegacyMigrationFailed();
      this.loaded = true;
    },

    async persist() {
      try {
        await saveSettings({
          models: this.models,
          categories: this.categories,
          draftText: this.draftText,
          ui: this.ui,
        });
      } catch (err) {
        if (err instanceof ReadOnlyStorageError) {
          // 只读保护：写被拒绝而非崩溃，界面横幅提示升级（spec: 降级只读保护）
          this.storageReadOnly = true;
          return;
        }
        throw err;
      }
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
      evictModelsCache(id);
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
        // 新建默认入「通用」（spec: settings 新建类别默认入通用）；调用方可显式指定分组
        groupId: input.groupId ?? null,
      };
      this.categories.push(cat);
      await this.persist();
      return cat;
    },

    async updateCategory(id: string, patch: Partial<ReviewCategory>): Promise<void> {
      const c = this.categories.find((x) => x.id === id);
      if (!c) return;
      const promptChanged = patch.prompt !== undefined && patch.prompt !== c.prompt;
      Object.assign(c, patch);
      await this.persist();
      // 提示词版本化（spec: settings Prompt 编辑器 / review-versioning D4）：
      // 保存即追加不可变版本（manual_edit），历史版本保留、currentVersion 前移；
      // 其余字段（名称/颜色/排序等）仍为原地更新。
      if (promptChanged) {
        await getRepo().appendPromptVersion(id, "manual_edit", c.prompt);
      }
    },

    async deleteCategory(id: string): Promise<void> {
      this.categories = this.categories.filter((c) => c.id !== id);
      await this.persist();
    },

    /** 复制类别：Prompt 相同、名称标副本、原类别不变（spec: settings 复制类别场景）；分组归属沿用被复制类别。 */
    async duplicateCategory(id: string): Promise<void> {
      const src = this.categories.find((c) => c.id === id);
      if (!src) return;
      // 浅拷贝即可（字段全为原始值）；不能用 structuredClone——src 是 reactive proxy，无法结构化克隆
      this.categories.push({
        ...src,
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

    // ---- Category Groups CRUD（spec: settings 类别分组管理）----
    async addGroup(name: string): Promise<CategoryGroup> {
      const g: CategoryGroup = {
        id: uid("grp"),
        name: name.trim() || "新分组",
        order: this.groups.length,
      };
      this.groups.push(g);
      await getRepo().insertGroup(g);
      return g;
    },

    async renameGroup(id: string, name: string): Promise<void> {
      const g = this.groups.find((x) => x.id === id);
      if (!g) return;
      const trimmed = name.trim();
      if (!trimmed) return; // 空名不落
      g.name = trimmed;
      await getRepo().renameGroup(id, trimmed);
    },

    /** 分组顺序调整（上移/下移）；「通用」不在 groups 列表，天然不可移。 */
    async moveGroup(id: string, dir: -1 | 1): Promise<void> {
      const sorted = [...this.groups].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((g) => g.id === id);
      const swapWith = idx + dir;
      if (idx < 0 || swapWith < 0 || swapWith >= sorted.length) return;
      const a = sorted[idx];
      const b = sorted[swapWith];
      const tmp = a.order;
      a.order = b.order;
      b.order = tmp;
      this.groups = sorted;
      await getRepo().moveGroup(id, dir);
    },

    /** 删除分组：仅解除归属，组内类别回落「通用」，MUST NOT 删除或改写类别其余字段。 */
    async deleteGroup(id: string): Promise<void> {
      if (!id) return; // 「通用」为虚拟组（id=null），任何入口触发删除都拒绝
      this.groups = this.groups.filter((g) => g.id !== id);
      for (const c of this.categories) {
        if (c.groupId === id) c.groupId = null;
      }
      await getRepo().deleteGroup(id);
    },

    /** 调整类别分组归属（null=通用）；不改 prompt、颜色、启停、默认选中与版本历史。 */
    async assignCategoryGroup(categoryId: string, groupId: string | null): Promise<void> {
      const c = this.categories.find((x) => x.id === categoryId);
      if (!c) return;
      c.groupId = groupId;
      await getRepo().assignCategoryGroup(categoryId, groupId);
    },

    async setDraftText(text: string): Promise<void> {
      this.draftText = text;
      await this.persist();
    },

    async setSplitPercent(p: number): Promise<void> {
      this.ui.splitPercent = Math.round(p);
      await this.persist();
    },

    async setSidebarCollapsed(v: boolean): Promise<void> {
      this.ui.sidebarCollapsed = v;
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
