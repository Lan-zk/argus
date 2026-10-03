// 应用数据持久化（spec: app-persistence / design 决策 4）。
// tauri-plugin-store JSON 文件（app-data 目录）：模型配置（脱敏，仅 keyringRef）、类别与 Prompt、
// 当前输入文本、最近一次 Review、UI 偏好。保存透明自动，不要求用户手动保存。

import { isTauri } from "./tauri";
import type { AppSettings, PersistedReview, ReviewCategory, ModelConfig } from "../domain/types";
import { DEFAULT_CATEGORIES } from "../domain/default-categories";

const STORE_FILE = "argus-store.json";
const K_SETTINGS = "settings";
const K_REVIEW = "lastReview";

interface StoredModelConfig extends Omit<ModelConfig, "apiKey"> {
  apiKey?: never;
}

export interface PersistedState {
  settings: AppSettings;
  lastReview: PersistedReview | null;
}

type StoreLike = {
  set(key: string, value: unknown): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  delete(key: string): Promise<boolean>;
  save(): Promise<void>;
};

let storePromise: Promise<StoreLike> | null = null;
/** 开发模式（无 Tauri）内存兜底。 */
const memoryPersist = new Map<string, unknown>();

async function getStore(): Promise<StoreLike> {
  if (!storePromise) {
    storePromise = (async () => {
      if (!isTauri()) {
        return {
          set: async (k, v) => void memoryPersist.set(k, v),
          get: async <T>(k: string) => memoryPersist.get(k) as T | undefined,
          delete: async (k: string) => memoryPersist.delete(k),
          save: async () => {},
        };
      }
      const { Store } = await import("@tauri-apps/plugin-store");
      return Store.load(STORE_FILE, { autoSave: false });
    })();
  }
  return storePromise;
}

/** 剥离 apiKey 字段（数据文件永不出现 Key 明文）；displayName trim 后空串归一为未设置。 */
export function sanitizeModelConfig(cfg: ModelConfig): StoredModelConfig {
  const { apiKey: _drop, displayName, ...rest } = cfg;
  void _drop;
  const dn = displayName?.trim();
  return { ...rest, ...(dn ? { displayName: dn } : {}) } as StoredModelConfig;
}

export function defaultSettings(): AppSettings {
  return {
    models: [],
    categories: structuredClone(DEFAULT_CATEGORIES),
    draftText: "",
    ui: { splitPercent: 60 },
  };
}

/** 读取全部持久化状态；首次运行时种入默认类别。 */
export async function loadState(): Promise<PersistedState> {
  const store = await getStore();
  const settingsRaw = await store.get<Partial<AppSettings>>(K_SETTINGS);
  const lastReview = (await store.get<PersistedReview>(K_REVIEW)) ?? null;
  const settings: AppSettings = {
    ...defaultSettings(),
    ...settingsRaw,
    categories:
      settingsRaw?.categories && settingsRaw.categories.length > 0
        ? settingsRaw.categories
        : defaultSettings().categories,
    ui: { ...defaultSettings().ui, ...(settingsRaw?.ui ?? {}) },
  };
  return { settings, lastReview };
}

/** 保存设置（模型配置脱敏 + 类别 + 草稿 + UI 偏好）。 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  const store = await getStore();
  await store.set(K_SETTINGS, {
    models: settings.models.map(sanitizeModelConfig),
    categories: settings.categories,
    draftText: settings.draftText,
    ui: settings.ui,
  });
  await store.save();
}

/** 保存最近一次 Review 完整结果。 */
export async function saveLastReview(review: PersistedReview): Promise<void> {
  const store = await getStore();
  await store.set(K_REVIEW, review);
  await store.save();
}

/** 清除并新建：删除最近一次 Review。 */
export async function clearLastReview(): Promise<void> {
  const store = await getStore();
  await store.delete(K_REVIEW);
  await store.save();
}

export type { ReviewCategory };
