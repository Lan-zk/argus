// Repo 工厂：Tauri 环境 → SQLite（{appDataDir}/argus.db）；开发/测试（浏览器）→ 内存实现。
// 分流沿用 isTauri() 惯例（替换原 plugin-store 的 memoryPersist 兜底）。
// SqliteRepo 可安全静态引入：插件模块仅在 open() 内动态加载（浏览器模式不触达）。

import { isTauri } from "../tauri";
import type { Repo } from "./types";
import { MemoryRepo } from "./memory";
import { SqliteRepo } from "./sqlite";

let instance: Repo | null = null;

export function getRepo(): Repo {
  if (!instance) {
    instance = isTauri() ? new SqliteRepo() : new MemoryRepo();
  }
  return instance;
}

/** 测试专用：重置单例为全新内存库（跨用例隔离）。 */
export function resetRepoForTests(): void {
  instance = new MemoryRepo();
}
