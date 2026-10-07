# src/lib/ — 基础设施

前端与 Tauri 壳之间的桥接层及通用工具：环境探测、网络通道、钥匙串、持久化、主题、对比度。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| `tauri.ts` | Tauri 环境探测与 **fetch 通道安装**：WebView 内把 `globalThis.fetch` 替换为 tauri http 插件 fetch（模型请求经 Rust 侧发出，免 CORS）；纯浏览器模式保留原生 fetch |
| `keyring.ts` | 钥匙串封装：调用 Rust 侧 `keyring_*` command 存取 API Key；浏览器模式走内存兜底 |
| `persistence.ts` | 持久化 facade（spec: app-persistence）：底层为 SQLite repo（见 `repo/`），保留 loadState/saveSettings/saveLastReview 接口；含旧 `argus-store.json` 首迁编排与失败重试；浏览器模式内存兜底 |
| `settings-merge.ts` | 读盘合并与脱敏（默认值打底、类别空则种默认、onboarding 老数据启发式、apiKey 剥离）：SQLite 读盘与旧数据首迁共用同一实现 |
| `repo/` | SQLite 存储层（review-versioning）：`types.ts`（行类型 + Repo 接口 + 禁改写 API 面）、`memory.ts`（内存实现）、`sqlite.ts`（tauri-plugin-sql 实现：{appDataDir}/argus.db、WAL、user_version 迁移、降级只读）、`repo.contract.ts`（双实现契约套件）；`migrations/`（有序迁移 v1 建库 / v2 多锚列 / v3 类别分组表 + 旧 JSON 首迁 `legacy.ts` + golden fixture 矩阵）；见 [`repo/README.md`](./repo/README.md) |
| `importers/` | 文档文件导入（spec: document-import）：dialog 选文件（浏览器 dev 降级 input[type=file]）+ txt/md 直读、docx（mammoth.browser）、pdf（pdfjs 文字层 + 断行拼段 + 双栏）提取，产出汇入既有 parseBlocks 管线；见 [`importers/README.md`](./importers/README.md) |
| `theme.ts` | 主题应用（spec: theme-system）：组合出 `data-theme` 并挂到根元素 |
| `contrast.ts` | WCAG 对比度计算（正文 ≥ 4.5:1、图形 ≥ 3:1），供 CategoryColorPicker 低对比提示与 [`scripts/contrast-check.mjs`](../../scripts/README.md) 复用 |
| `constants.ts` | 全局常量（如文稿长度上限 30 000 字符） |
| `sample.ts` | 示例文稿（新建审阅页的试用内容） |
| `dev-spike.ts` | 开发联调钩子（**仅 debug 构建生效**）：经 Rust 侧 `dev_spike_*` command 读写 spike 文件，驱动应用内全链路验证，见 [`docs/known-issues.md`](../../docs/README.md) |

`*.test.ts` 为对应单测（vitest）。
