// 有序迁移框架（design D3；spec: app-persistence 存储迁移与版本兼容）。
// PRAGMA user_version 为唯一版本锚点；每步幂等可重放，版本号最后写——
// 崩溃后下次启动对同一步骤安全重放，达到「原子生效」等效（tasks 1.3 定稿方案 B）。
// 降级保护由调用方处理：user_version 高于 APP_SCHEMA_VERSION 时不执行迁移并置只读。

import { v1 } from "./v1";
import { v2 } from "./v2";
import { v3 } from "./v3";

export interface MigrationDb {
  exec(sql: string, params?: unknown[]): Promise<void>;
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Migration {
  toVersion: number;
  up(db: MigrationDb): Promise<void>;
}

/** 当前应用已知的 schema 版本。触及存储的变更 MUST 在此追加迁移并更新 golden fixture。 */
export const APP_SCHEMA_VERSION = 3;

export const MIGRATIONS: Migration[] = [v1, v2, v3];

export async function readSchemaVersion(db: MigrationDb): Promise<number> {
  const rows = await db.select<{ user_version: number }>("PRAGMA user_version");
  return rows[0]?.user_version ?? 0;
}

/** 按序执行迁移至 APP_SCHEMA_VERSION。幂等：已应用步骤跳过，未完成步骤安全重放。 */
export async function applyMigrations(db: MigrationDb): Promise<number> {
  let version = await readSchemaVersion(db);
  if (version > APP_SCHEMA_VERSION) return version; // 调用方据此进入只读保护
  for (const m of MIGRATIONS) {
    if (version >= m.toVersion) continue;
    await m.up(db);
    await db.exec(`PRAGMA user_version = ${m.toVersion}`);
    version = m.toVersion;
  }
  return version;
}
