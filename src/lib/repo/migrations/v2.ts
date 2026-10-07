// schema v2 迁移（spec: finding-anchor-spans app-persistence 多锚结构存储）：
// findings 追加 anchors_json 列（可空 JSON，存多锚结构；旧列保持主锚投影双写）。
// 幂等可重放：先查 pragma_table_info，列已存在则跳过；user_version 由框架最后写。

import type { Migration } from "./index";

export const v2: Migration = {
  toVersion: 2,
  up: async (db) => {
    const cols = await db.select<{ name: string }>(
      "SELECT name FROM pragma_table_info('findings') WHERE name = 'anchors_json'",
    );
    if (cols.length === 0) {
      await db.exec("ALTER TABLE findings ADD COLUMN anchors_json TEXT");
    }
  },
};
