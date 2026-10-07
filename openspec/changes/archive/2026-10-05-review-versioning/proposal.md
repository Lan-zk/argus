## Why

当前应用只保留最近一次审阅结果（单一 `lastReview` 槽位），任何重跑都会覆盖销毁历史；用户「输入 → 审阅 → 修改 → 再传入 → 再审阅」的迭代循环无法成立，也无法回答「上一轮的问题改掉了吗」。同时，类别提示词修改后历史轮次无法复现当时所用逻辑，现有 JSON 存储整体读写的形态也无法支撑多项目多轮数据与已发布版本的升级兼容。

## What Changes

- **存储引擎迁移（BREAKING，仅存储格式，对用户无感）**：`tauri-plugin-store` JSON 文件 → SQLite（tauri-plugin-sql）全关系表 schema v1；设置与审阅数据全部入库；移除 plugin-store 依赖
- **迁移与版本兼容**：`user_version` 有序迁移框架（每步原子生效，原子性方案经 spike 定稿）；旧 `argus-store.json` 自动拆包迁移（最近一次审阅成为「导入的审阅」项目的第一轮）；副本式备份（原文件保留原地、完成标记防重复）、失败可重试；数据库版本高于应用时只读保护；fixture 迁移测试挂 CI
- **命名审阅项目**：创建、重命名、删除（确认）、列表管理
- **多轮审阅与不可变快照**：每轮冻结文档全文、所选类别及提示词版本、模型配置、运行记录、Findings 与报告；轮次不因外部变更（提示词修改、模型删除）被改写；轮内单类重跑是唯一重写路径（级联重算该轮对比与报告）；「重新分析」= 开新一轮
- **新一轮配置沿用**：默认沿用上一轮快照配置保证对比纯净度；改动后对比标注「仅供参考」；全新项目首轮用默认模型
- **双层跨轮对比**：文档确认后即时计算「上轮问题改没改」（确定性判定，不依赖模型）；审阅完成后计算「疑似遗留」（附置信度，两轮说法可并排）；结果持久化
- **Findings 增量落库**：产出即写入数据库，审阅中断后已产出部分可恢复查看
- **单类重跑语义修改**：改用本轮冻结的提示词版本，不再使用类别当前最新 Prompt
- **手动编辑提示词版本化（提前并入本 change）**：设置页保存 Prompt 即追加不可变版本（manual_edit），消除「改了提示词但轮次版本指针失真」的过渡期错误；版本历史 UI 与 skill 导入留给 skill-packages
- **UI**：新增审阅列表页；工作台新增轮次切换、对比面板、单问题跨轮并排

## Capabilities

### New Capabilities

- `review-versioning`: 命名审阅项目与多轮次的生命周期、不可变轮次快照、新一轮配置沿用、跨轮双层对比（确定性「改没改」与概率性「疑似遗留」）、轮次管理

### Modified Capabilities

- `app-persistence`: 存储引擎由 JSON store 改为 SQLite；「最近一次 Review」语义改为「审阅项目列表与最后活动位置」；新增存储迁移、版本兼容与降级保护需求
- `review-orchestration`: 审阅会话归属项目轮次；单类重跑改用轮次冻结的提示词版本（原为「最新 Prompt」）
- `review-ui`: 新增审阅列表页与轮次对比界面行为（列表、轮次切换、对比面板、跨轮并排、配置变更提示）
- `settings`: 「模型配置管理」的默认模型适用范围界定（新项目首轮 vs 项目内沿用上轮快照），消除与「新一轮配置沿用」的 requirement 冲突

## Impact

- **依赖**：新增 `tauri-plugin-sql`（bundled SQLite）；移除 `@tauri-apps/plugin-store`；Tauri capabilities 增补 sql 权限
- **代码**：`src/lib/persistence.ts` 重写为 `src/lib/repo/` SQLite 访问层；`src/stores/session.ts`、`src/orchestrator/*` 接入轮次模型与增量落库；`src/pages/` 新增列表页；`src/domain/types.ts` 新增 Project/Round 等类型
- **数据**：已发布版本的 `argus-store.json` 首启自动迁移（原文件备份保留）；此后任何触及存储的变更必须携带迁移步骤与 fixture 更新（工程纪律，写入项目规范）
- **下游**：为 `document-import`（`documents.source_meta`）与 `skill-packages`（`category_prompt_versions`）两个 change 提供存储基础；建议先于两者实施
