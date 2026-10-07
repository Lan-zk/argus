// 读盘合并与脱敏（原 persistence.ts 中的合并逻辑抽出，供 SQLite 读盘与旧数据首迁共用同一实现，
// 避免两套合并规则漂移——review-versioning 评审修订项）。

import type { AppSettings, ModelConfig, ReviewCategory, UiPrefs } from "../domain/types";
import { DEFAULT_CATEGORIES } from "../domain/default-categories";
import type { StoredCategory, StoredModel } from "./repo/types";

export type { StoredModel };

/** 持久化前脱敏：剥除 apiKey（数据库永不出现 Key 明文）；displayName trim 后空串归一为未设置。 */
export function sanitizeModelConfig(cfg: ModelConfig): StoredModel {
  const { apiKey: _drop, displayName, ...rest } = cfg;
  void _drop;
  const dn = displayName?.trim();
  return { ...rest, ...(dn ? { displayName: dn } : {}) };
}

export interface RawLoadedSettings {
  models: StoredModel[];
  categories: StoredCategory[];
  draftText?: string;
  ui?: Partial<UiPrefs>;
}

function storedToCategory(c: StoredCategory): ReviewCategory {
  const { currentVersion: _cv, ...rest } = c;
  void _cv;
  return rest;
}

/** 读盘合并（与旧 loadState 行为等价）：默认值打底、类别空则种默认、onboarding 老数据启发式。 */
export function mergeLoadedSettings(raw: RawLoadedSettings): AppSettings {
  const ui: UiPrefs = {
    splitPercent: 60,
    theme: "swiss",
    appearance: "system",
    onboarded: false,
    ...raw.ui,
  };
  // 升级迁移（spec: onboarding 老数据兼容）：缺标记但已有模型配置 → 视为已初始化，老用户不被打扰
  if (raw.ui?.onboarded === undefined && raw.models.length > 0) {
    ui.onboarded = true;
  }
  const categories: ReviewCategory[] =
    raw.categories.length > 0 ? raw.categories.map(storedToCategory) : structuredClone(DEFAULT_CATEGORIES);
  return {
    models: raw.models,
    categories,
    draftText: raw.draftText ?? "",
    ui,
  };
}
