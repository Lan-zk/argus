// Repo 双实现契约测试（tasks 1.2/1.4）：
// - 内存实现：恒跑（开发/测试兜底）
// - SQLite 实现：经 node:sqlite（Node 24+ 内置）驱动真实引擎跑同一套断言；
//   SQL 语句与映射即 Tauri 运行时（plugin-sql）所用路径。node:sqlite 不可用时整组跳过。

import { describe, expect, it } from "vitest";
import { MemoryRepo } from "./memory";
import { SqliteRepo } from "./sqlite";
import type { Repo } from "./types";
import { ReadOnlyStorageError } from "./types";
import { runRepoContractSuite } from "./repo.contract";

interface DbSync {
  prepare(sql: string): { run(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
  exec(sql: string): void;
  close(): void;
}

async function loadNodeSqlite(): Promise<{ DatabaseSync: new (path: string) => DbSync } | null> {
  try {
    return (await import("node:sqlite")) as { DatabaseSync: new (path: string) => DbSync };
  } catch {
    return null;
  }
}

/** node:sqlite :memory: 库适配 plugin-sql Database 接口（execute/select + ? 占位参数）。 */
export async function makeNodeSqliteRepo(): Promise<{ repo: Repo; raw: DbSync }> {
  const m = (await loadNodeSqlite())!;
  const db = new m.DatabaseSync(":memory:");
  const adapter = {
    async execute(sql: string, params: unknown[] = []) {
      db.prepare(sql).run(...params);
    },
    async select<T>(sql: string, params: unknown[] = []): Promise<T> {
      return db.prepare(sql).all(...params) as T;
    },
  };
  const repo = new SqliteRepo(async () => adapter);
  return { repo, raw: db };
}

runRepoContractSuite(() => new MemoryRepo());

if (await loadNodeSqlite()) {
  runRepoContractSuite(async () => (await makeNodeSqliteRepo()).repo);

  describe("sqlite 迁移执行器与降级保护（tasks 1.3/1.7）", () => {
    it("空库建库至 user_version=3，二次 open 幂等", async () => {
      const { repo, raw } = await makeNodeSqliteRepo();
      await repo.open();
      await repo.open();
      const uv = raw.prepare("PRAGMA user_version").all() as { user_version: number }[];
      expect(uv[0].user_version).toBe(3);
      const cols = raw.prepare("SELECT name FROM pragma_table_info('findings') WHERE name='anchors_json'").all();
      expect(cols).toHaveLength(1);
      raw.close();
    });

    it("v1 库升级到最新：anchors_json 加列、既有数据完好、重放不重复加列（spec: finding-anchor-spans 迁移）", async () => {
      const { repo, raw } = await makeNodeSqliteRepo();
      // 只跑 v1 建库并写入一条 finding（模拟 v1 应用留下的库），锚定 user_version=1
      const { v1 } = await import("./migrations/v1");
      const mdb = {
        exec: async (sql: string, params: unknown[] = []): Promise<void> => {
          raw.prepare(sql).run(...params);
        },
        select: async <T>(sql: string, params: unknown[] = []): Promise<T> => raw.prepare(sql).all(...params) as T,
      };
      await v1.up(mdb);
      // 外键父行（projects → rounds → runs）后插 findings
      raw.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p', 'n', 't', 't')").run();
      raw.prepare("INSERT INTO rounds (id, project_id, number, status, category_snapshot, model_snapshot, created_at) VALUES ('r', 'p', 1, 'completed', '[]', '{}', 't')").run();
      raw.prepare("INSERT INTO runs (id, round_id, category_id, category_version, status) VALUES ('u', 'r', 'logic', 1, 'completed')").run();
      raw.prepare(
        "INSERT INTO findings (id, round_id, run_id, category_id, severity, title, quote, problem, reason, suggestion, anchor_status) VALUES ('old1','r','u','logic','high','t','q','p','r','s','anchored')",
      ).run();
      raw.prepare("PRAGMA user_version = 1").run();

      // 新版本应用打开 → 迁移到最新
      await repo.open();
      await repo.open(); // 幂等重放
      const uv = raw.prepare("PRAGMA user_version").all() as { user_version: number }[];
      expect(uv[0].user_version).toBe(3);
      const cols = raw.prepare("SELECT name FROM pragma_table_info('findings') WHERE name='anchors_json'").all();
      expect(cols).toHaveLength(1); // 重放不产生重复列
      const rows = raw.prepare("SELECT id, anchors_json FROM findings").all() as { id: string; anchors_json: string | null }[];
      expect(rows).toEqual([{ id: "old1", anchors_json: null }]); // 旧数据完好、无 anchors
      raw.close();
    });

    it("v2 库升级到 v3：category_groups 建表、categories 加 group_id 列、既有类别回落通用、重放不重复加列（spec: settings 类别分组管理）", async () => {
      const { repo, raw } = await makeNodeSqliteRepo();
      // 建到 v2（模拟 v2 应用留下的库）并写入类别行
      const { v1 } = await import("./migrations/v1");
      const { v2 } = await import("./migrations/v2");
      const mdb = {
        exec: async (sql: string, params: unknown[] = []): Promise<void> => {
          raw.prepare(sql).run(...params);
        },
        select: async <T>(sql: string, params: unknown[] = []): Promise<T> => raw.prepare(sql).all(...params) as T,
      };
      await v1.up(mdb);
      await v2.up(mdb);
      raw.prepare("INSERT INTO categories (id, name, prompt, enabled, default_selected, sort_order, current_version, created_at) VALUES ('logic','逻辑','p',1,1,0,1,'t')").run();
      raw.prepare("PRAGMA user_version = 2").run();

      // 新版本应用打开 → 迁移到 v3
      await repo.open();
      await repo.open(); // 幂等重放
      const uv = raw.prepare("PRAGMA user_version").all() as { user_version: number }[];
      expect(uv[0].user_version).toBe(3);
      const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='category_groups'").all();
      expect(tables).toHaveLength(1);
      const cols = raw.prepare("SELECT name FROM pragma_table_info('categories') WHERE name='group_id'").all();
      expect(cols).toHaveLength(1); // 重放不产生重复列
      const cats = await repo.listCategories();
      expect(cats.find((c) => c.id === "logic")?.groupId ?? null).toBeNull(); // 旧类别回落通用
      // 升级后组 CRUD 与归属读写即刻可用
      await repo.insertGroup({ id: "g1", name: "小说", order: 0 });
      await repo.assignCategoryGroup("logic", "g1");
      expect((await repo.listCategories()).find((c) => c.id === "logic")?.groupId).toBe("g1");
      raw.close();
    });

    it("user_version 高于应用已知版本 → 只读，写抛 ReadOnlyStorageError，读仍可用", async () => {
      const m = (await loadNodeSqlite())!;
      const db = new m.DatabaseSync(":memory:");
      const adapter = {
        async execute(sql: string, params: unknown[] = []) {
          db.prepare(sql).run(...params);
        },
        async select<T>(sql: string, params: unknown[] = []): Promise<T> {
          return db.prepare(sql).all(...params) as T;
        },
      };
      // 先以当前版本建库（真实场景：库由更新版本应用创建，表已存在）
      await new SqliteRepo(async () => adapter).open();
      db.exec("PRAGMA user_version = 99"); // 模拟「更新版本应用」写过的库
      const repo = new SqliteRepo(async () => adapter);
      await repo.open();
      expect(repo.readOnly).toBe(true);
      await expect(repo.setPref("x", 1)).rejects.toBeInstanceOf(ReadOnlyStorageError);
      expect(await repo.listModels()).toEqual([]);
      db.close();
    });
  });
} else {
  describe.skip("sqlite（node:sqlite 不可用，跳过真实引擎契约）", () => {
    it("placeholder", () => undefined);
  });
}
