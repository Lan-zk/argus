// 应用数据持久化（spec: app-persistence / design 决策 4 → review-versioning D1-D3）。
// 底层已由 tauri-plugin-store JSON 迁移至 SQLite repo（src/lib/repo/，Tauri 环境）
// / 内存实现（开发与测试）。本模块保留 loadState/saveSettings/saveLastReview facade，
// 既有调用方与测试零改动。
// 旧 argus-store.json 首迁：读取（Rust legacy_store_read）→ 拆包入库（migrations/legacy.ts）
// → 副本式备份（Rust legacy_store_backup，copy 不移动原文件）；失败保留原文件、下次启动重试。

import { isTauri } from "./tauri";
import type { AppSettings, PersistedReview, UiPrefs } from "../domain/types";
import { DEFAULT_CATEGORIES } from "../domain/default-categories";
import { getRepo } from "./repo";
import type { Repo } from "./repo/types";
import { migrateLegacyStore, type LegacyStoreJson } from "./repo/migrations/legacy";
import { mergeLoadedSettings, sanitizeModelConfig } from "./settings-merge";

export interface PersistedState {
  settings: AppSettings;
  lastReview: PersistedReview | null;
}

export { sanitizeModelConfig };
export type { ReviewCategory } from "../domain/types";

const PREF_UI = "ui";
const PREF_DRAFT = "draftText";
const PREF_LAST_REVIEW = "lastReview";
const PREF_LEGACY_MIGRATED = "legacyMigrated";

export function defaultSettings(): AppSettings {
  return {
    models: [],
    categories: structuredClone(DEFAULT_CATEGORIES),
    draftText: "",
    ui: { splitPercent: 60, theme: "swiss", appearance: "system", onboarded: false },
  };
}

/** 首迁失败标记（供设置 store 状态与界面提示条读取）。 */
let legacyMigrationFailed = false;

export function isLegacyMigrationFailed(): boolean {
  return legacyMigrationFailed;
}

let opened = false;

async function ensureOpen(): Promise<void> {
  if (opened) return;
  const repo = getRepo();
  await repo.open();
  if (isTauri()) await migrateLegacyIfPresent(repo);
  opened = true;
}

/** 旧数据首迁（幂等；只读保护下跳过）。失败置标记并以现有数据继续，下次启动重试。 */
async function migrateLegacyIfPresent(repo: Repo): Promise<void> {
  if (repo.readOnly) return;
  try {
    if (await repo.getPref<boolean>(PREF_LEGACY_MIGRATED)) return;
    const { invoke } = await import("@tauri-apps/api/core");
    const json = await invoke<string | null>("legacy_store_read");
    if (json === null) {
      // 无旧文件（新装/已迁移后文件被用户清理）：标记免反复探测
      await repo.setPref(PREF_LEGACY_MIGRATED, true);
      return;
    }
    await migrateLegacyStore(repo, JSON.parse(json) as LegacyStoreJson);
    // 成功后副本式备份；备份失败不阻断（原文件仍在原地，迁移已由完成标记保护）
    await invoke<string | null>("legacy_store_backup").catch(() => null);
  } catch (err) {
    legacyMigrationFailed = true;
    console.error("[argus] legacy store migration failed, will retry next launch:", err);
  }
}

/** 读取全部持久化状态（含旧版合并默认与 onboarding 老数据启发式，见 settings-merge）。 */
export async function loadState(): Promise<PersistedState> {
  await ensureOpen();
  const repo = getRepo();
  const models = await repo.listModels();
  const categories = await repo.listCategories();
  const ui = await repo.getPref<Partial<UiPrefs>>(PREF_UI);
  const draftText = await repo.getPref<string>(PREF_DRAFT);
  const settings = mergeLoadedSettings({ models, categories, draftText, ui });
  const lastReview = (await repo.getPref<PersistedReview | null>(PREF_LAST_REVIEW)) ?? null;
  return { settings, lastReview };
}

/** 保存设置：模型脱敏入库、类别 upsert（保留 currentVersion 指针）、偏好写 app_prefs。 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  await ensureOpen();
  const repo = getRepo();
  const storedModels = settings.models.map(sanitizeModelConfig);
  const existingModels = await repo.listModels();
  for (const m of storedModels) await repo.putModel(m);
  const keepModelIds = new Set(storedModels.map((m) => m.id));
  for (const e of existingModels) {
    if (!keepModelIds.has(e.id)) await repo.deleteModel(e.id);
  }

  const existingCats = await repo.listCategories();
  const versionById = new Map(existingCats.map((c) => [c.id, c.currentVersion]));
  for (const c of settings.categories) {
    await repo.putCategory({
      id: c.id,
      name: c.name,
      ...(c.en !== undefined ? { en: c.en } : {}),
      ...(c.description !== undefined ? { description: c.description } : {}),
      ...(c.color !== undefined ? { color: c.color } : {}),
      prompt: c.prompt,
      enabled: c.enabled,
      defaultSelected: c.defaultSelected,
      order: c.order,
      currentVersion: versionById.get(c.id) ?? 1,
      groupId: c.groupId ?? null,
    });
  }
  const keepCatIds = new Set(settings.categories.map((c) => c.id));
  for (const e of existingCats) {
    if (!keepCatIds.has(e.id)) await repo.deleteCategory(e.id);
  }

  await repo.setPref(PREF_UI, settings.ui);
  await repo.setPref(PREF_DRAFT, settings.draftText);
}

/** 保存最近一次 Review 完整结果（里程碑 1 起由项目/轮次关系表取代）。 */
export async function saveLastReview(review: PersistedReview): Promise<void> {
  await ensureOpen();
  await getRepo().setPref(PREF_LAST_REVIEW, review);
}

/** 清除并新建：删除最近一次 Review。 */
export async function clearLastReview(): Promise<void> {
  await ensureOpen();
  await getRepo().deletePref(PREF_LAST_REVIEW);
}
