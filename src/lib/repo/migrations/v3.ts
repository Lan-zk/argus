// schema v3 迁移（spec: settings 类别分组管理）：
// 新建 category_groups 表 + categories 追加 group_id 可空列（NULL=「通用」虚拟组，design D1）。
// 幂等可重放：建表 IF NOT EXISTS、加列先查 pragma_table_info，版本已过则跳过；user_version 由框架最后写。

import type { Migration } from "./index";

export const v3: Migration = {
  toVersion: 3,
  up: async (db) => {
    await db.exec(`CREATE TABLE IF NOT EXISTS category_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`);
    const cols = await db.select<{ name: string }>(
      "SELECT name FROM pragma_table_info('categories') WHERE name = 'group_id'",
    );
    if (cols.length === 0) {
      // SQLite 加列不支持 IF NOT EXISTS：由上方 pragma 探测保证幂等。
      // 列级 REFERENCES 可经 ALTER TABLE 添加（默认值必须为 NULL，满足可空语义）。
      await db.exec("ALTER TABLE categories ADD COLUMN group_id TEXT REFERENCES category_groups(id)");
    }
  },
};
