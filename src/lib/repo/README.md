# src/lib/repo/ — SQLite 存储层

Tauri 环境 SQLite 持久化（`{appDataDir}/argus.db`，WAL）与开发/测试内存实现的合集。spec: app-persistence（存储迁移与版本兼容）+ review-versioning（行类型与不可变轮次）。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| `types.ts` | 行类型（StoredModel / StoredCategory / RoundRow / FindingRow 等）+ `Repo` 接口 + 禁改写 API 面（`FORBIDDEN_REPO_METHODS`）+ `ReadOnlyStorageError` |
| `memory.ts` | 内存实现（浏览器 dev / 测试兜底），与 SQLite 实现跑同一套契约测试 |
| `sqlite.ts` | tauri-plugin-sql 实现：绝对路径钉死数据目录、WAL、user_version 迁移、降级只读保护 |
| `repo.contract.ts` | 双实现契约套件（`repo.test.ts` 分别以内存与 node:sqlite 真实引擎驱动） |
| `index.ts` | Repo 工厂：Tauri → SQLite，否则内存；`resetRepoForTests()` 测试隔离 |
| `migrations/` | 有序迁移（见下）+ 旧 `argus-store.json` 首迁 `legacy.ts` + golden fixture 矩阵 |

## Schema 版本（user_version）

每步迁移幂等可重放（`IF NOT EXISTS` / pragma 探测 / `OR IGNORE`），`user_version` 最后写，崩溃后下次启动安全重放。触及存储的变更 MUST 追加迁移步骤 + golden fixture（`migrations/fixtures/`，各历史版本脱敏样本，矩阵测试与 CI 全量校验）；`APP_SCHEMA_VERSION`（`migrations/index.ts`）为应用已知上限，库更高时 Repo 只读（写抛 `ReadOnlyStorageError`）。

| 版本 | 内容 |
| --- | --- |
| v1 | 建库：model_configs / categories / category_prompt_versions / app_prefs / projects / rounds / documents / document_blocks / runs / findings / reports / finding_links |
| v2 | findings 追加 `anchors_json` 可空列（spec: finding-anchor-spans 多锚结构，旧列保持主锚投影） |
| v3 | 新建 `category_groups(id, name, sort_order, created_at)` + categories 追加 `group_id` 可空列（spec: settings 类别分组管理） |

## 分组区约定（spec: settings 类别分组管理）

- **「通用」为虚拟组不落行**：`group_id IS NULL` 即通用，恒在、置顶、不可删不可改名由构造保证。
- 删组 = `UPDATE categories SET group_id = NULL`（先）+ `DELETE FROM category_groups`（后），仅解除归属、不删类别，两步均幂等；类别其余字段与 `category_prompt_versions` 历史不动（版本表按 `category_id` 关联，与组无关）。
- 组 CRUD（listGroups / insertGroup / renameGroup / moveGroup / deleteGroup / assignCategoryGroup）由 `Repo` 接口提供，memory 与 sqlite 同语义，契约测试覆盖。
