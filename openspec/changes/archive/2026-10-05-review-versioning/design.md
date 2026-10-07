# review-versioning — 技术设计

## Context

见 proposal「Why」。现状约束：`src/lib/persistence.ts` 基于 tauri-plugin-store，仅 `settings` 与 `lastReview` 两个 key，`save()` 全文件重写、全量驻留内存；findings 只进 Pinia 内存、`persistReview()` 审毕一次性落盘；`ReviewSession` 仅存 `selectedCategoryIds`，无提示词快照；`rerunCategory` 用「最新 Prompt」重跑；无迁移机制，而应用已有带 CI 的多平台发布，存量用户数据真实存在。领域类型集中在 `src/domain/types.ts`，全部领域逻辑在前端 TS（Rust 侧仅 keyring）。

## Goals / Non-Goals

**Goals:**

- 存储一次性迁移到位：引擎（SQLite）与 schema（项目/轮次/版本）在同一变更中落定，用户只经历一次数据迁移
- 轮次快照不可变：提示词版本、模型配置随轮冻结，历史可复现、跨轮对比纯净
- 双层对比：「改没改」确定性且即时（零模型调用），「疑似遗留」概率性且带置信度
- 已发布版本用户的旧数据无损升级，回滚安装不毁数据
- Findings 增量落库，审阅中断可恢复部分结果

**Non-Goals:**

- 不做 App 内文档编辑器（用户在 App 外修改后传回）
- 不做用户手写批注或 Finding 状态标记（findings 即批注）
- 不做跨项目统计/搜索 UI（schema 已支持，留给未来）
- 不引入 OCR 与旧 .doc 解析（属 document-import 边界）

## Decisions

### D1：存储引擎 — SQLite 全关系表，tauri-plugin-sql 前端驱动

- 备选 A：plugin-store 同文件拆 key —— 否决：store 整文件载入、save 全量重写，拆 key 拿不到懒加载与局部写
- 备选 B：多 store 文件 / fs 文件树（每轮一文件）—— 否决：索引、崩溃安全（tmp+rename）、迁移框架全需自制
- 备选 C：SQLite kv+JSON（单表存 JSON）—— 否决（用户决策）：放弃跨轮/跨项目查询与引用完整性，换取更少映射代码；本项目已选定全关系
- **选定**：`tauri-plugin-sql` + bundled SQLite，SQL 全部收拢在 `src/lib/repo/` 单一目录，对上层暴露实体级函数。符合「肥 TS 前端」架构，不把逻辑右移到 Rust
- 混合纪律：**可查询、可 JOIN、进 WHERE 的字段做真实列；纯展示嵌套结构存 JSON TEXT 列**（报告摘要、快照、来源元信息）。全关系 ≠ 零 JSON

### D2：schema v1 — uuid 文本主键，不可变性收窄为「不因外部变更改写」

表结构（DDL 见任务 1.2，关键约束如下）：

- `model_configs` / `categories`（**含 `current_version` 真列**——skill-packages 的升级/回落依赖，v1 必须建出）/ `category_prompt_versions`（append-only，`UNIQUE(category_id, version)`）/ `app_prefs`（杂项 kv）
- `projects` / `rounds`（`UNIQUE(project_id, number)`；`category_snapshot`/`model_snapshot` 为 JSON 列）
- `documents`（`round_id` UNIQUE；**含 `source_meta` JSON 列**——document-import 的来源元数据依赖，v1 必须建出）+ `document_blocks`（复合主键 `document_id, seq`）
- `runs`（含 `category_version` 真列——「本轮用了哪个提示词版本」可审计）
- `findings`（索引：`round_id`、`content_hash`）
- `reports`（`round_id` 主键）
- `finding_links`（**自增行主键** + 索引 `(curr_round_id)`、`(prev_finding_id)`；不设复合唯一键——L2 匹配允许一个旧问题对应多条新 finding 的多对一情形；`link_type: unresolved|edited|recurring|ambiguous`，`confidence REAL?`）——对比结果持久化为一等数据
- 主键一律应用侧生成的 uuid 文本（领域对象不感知自增；`category_prompt_versions`/`finding_links` 内部自增除外）
- 不可变性约束（与 spec 同步收窄）：findings/documents/reports 完成后**不因外部变更（提示词/模型配置修改删除）提供任何改写路径**；唯一重写路径是轮内单类重跑（DELETE 该类别 findings + INSERT 新 findings + 级联作废重算该轮 finding_links 与报告）；repo API 按此设计，不提供其他 UPDATE/DELETE 方法；`runs.status` 仅在轮次 running 期间可更新

### D3：迁移框架 — user_version + 有序迁移 + 首迁拆包（副本式备份）

- `PRAGMA user_version` 为唯一版本锚点；`src/lib/repo/migrations/` 下每个版本一个模块（`v1.ts` 建库…），启动时按序执行
- **原子性（评审修订；spike 已定稿：方案 B）**：tauri-plugin-sql 基于 sqlx 连接池，JS 侧 `BEGIN/COMMIT` 无连接亲和、且单次 execute 仅接受单条语句——「每步事务」不能靠 JS 拼 SQL 实现。落选方案 A（Rust 侧 `execute_batch` 单连接事务命令）：避免为迁移独占引入第二套 Rust 侧存储通道。**选定 B：每步幂等（`IF NOT EXISTS` / `INSERT OR IGNORE` / 确定性 id）+ `user_version` 最后写**——崩溃后对同一步骤安全重放，达到等效原子性；未来出现不可幂等的破坏性变更时再评估升级为方案 A
- 首迁（json → SQLite，评审修订为副本式备份）：启动检测旧 `argus-store.json` 仍存在于原路径且库内无迁移完成标记 → 迁移成功后**复制**一份 `argus-store.backup-<date>.json`、再写完成标记（原文件保留原地，标记防重复迁移；不做重命名/移动——移动会破坏「失败可重试」与「回滚后旧版可读」两个承诺）→ `settings.models→model_configs`、`settings.categories→categories + prompt_versions v1(builtin)`、`ui/draftText→app_prefs`（**复刻 loadState 的默认合并与 onboarding 老数据启发式**：缺 onboarded 但有 models → 视为已初始化，避免存量用户被重新弹引导）、`lastReview→project「导入的审阅」+ Round 1 全套`。任何步骤失败：原文件原样、无完成标记、下次启动重试
- 降级保护：`user_version` 高于应用已知版本 → 全局只读开关 + 升级提示；旧版本应用对 db 文件无感知；已迁移用户回滚安装旧版后，旧版仍能读到原路径的 `argus-store.json`（副本式备份保证），数据不丢
- 工程纪律：仓库保存脱敏 golden fixture（真实 `argus-store.json`），CI 对每个历史 user_version 跑「迁移到最新」矩阵测试；**触及存储的 change 必须携带迁移步骤与 fixture 更新**（写入 openspec/config.yaml 的 operations guidance，任务化）

### D4：轮次模型、配置沿用与提示词版本化（手动编辑版本化并入本 change）

- `orchestrator.start()` 语义从「创建全局唯一 session」改为「在项目下创建 Round N」；`PersistedReview` 拆解入库；工作台「重新分析」= 开新一轮（不覆盖既有轮次）
- 开新一轮：默认复制上一轮 `category_snapshot`/`model_snapshot`；全新项目首轮用默认模型与当前提示词；UI 允许改选，任何改动在轮次上记 `config_changed=true`，对比面板据此显示「仅供参考」
- **手动编辑版本化提前到本 change**（评审修订：否则过渡期「用户改了提示词但 runs.category_version 仍指 v1」，重跑会用旧提示词、审计失真）：settings store 的 `updateCategory` 在 prompt 变更时即「INSERT 新版本（manual_edit）+ 前移 current_version」，其余字段原地更新；skill-packages 只补版本历史 UI 与 skill 导入，不再承担该改造
- `rerunCategory` 取 `runs.category_version` 冻结版本拼装提示词（spec 已同步修改）；轮内重跑级联作废并重算该轮 finding_links 与报告（见 D2）；「显式升级本轮配置」= 以新版本重开一轮，而非轮内替换
- 恢复逻辑：`app_prefs.lastActive = {projectId, roundId}`，启动恢复到该位置；无记录落列表页；`resume()` 顺带修复现存隐患——从轮次快照恢复 `activeCategories/activeModelConfig`，重跑触发报告时类别集合不丢

### D5：双层对比引擎

```
输入确认 ──> 归一化(与 parser/anchor 同源规则) ──> 块级 diff(npm 包名 diff,即 jsdiff)
                │                                    │
                │                              位置映射表(v1块↔v2块)
                v                                    v
   L1 即时·确定性                        L2 审阅完成后·概率性
   旧 finding quote 在新文档模糊匹配      contentHash 精确 + 位置邻近
   → unresolved / edited / ambiguous     + title/problem 相似度合成
   写 finding_links (confidence=NULL)    confidence，recurring 指向新 finding
                                          (允许一个旧问题对应多条新 finding)
```

- 归一化必须与 `parser.ts`/`anchor.ts` 用同一实现（抽 `src/domain/normalize.ts`），否则 diff 噪声污染 L1
- L1 模糊匹配容忍空白/标点级小改（编辑距离阈值），quote 原样存在 → unresolved；找不到 → edited；命中区间跨 diff 变更块 → ambiguous
- L2 相似度：优先 contentHash 精确命中，其次位置映射邻近 + 文本相似度（title/problem 归一化后相似度，不引入 embedding）；阈值与 confidence 映射为**spike 任务**，用真实文档三粒度改动（改词/改句/挪段）实测调参
- 对比只在相邻轮间计算；轮次删除后由后台补算新相邻对的 links；轮内单类重跑后该轮参与的 links 作废重算

### D6：Findings 增量落库

- SessionSink 双写：Pinia（UI 实时）+ repo（每条 finding 产出即 INSERT，run 状态变更即 UPDATE）
- 崩溃恢复：启动发现 `rounds.status = running` 但无活动 orchestrator → 标记 `partial_failed`，已落库 findings 照常展示，UI 标注「该轮未完成」
- 开发模式兜底：plugin-sql 无浏览器实现，repo 层定义接口 + 内存实现（替代现 `memoryPersist`），两实现跑同一套接口单测

### D7：UI 结构 — 顶层两入口，审阅循环全下钻

- 信息架构（原型 `design/03-迭代二交互原型.html` 定稿）：顶层导航仅「审阅」「设置」两个入口；主流程（项目列表 → 工作台 → 开新一轮输入 → 回工作台）全部在「审阅」内以下级页面 + 面包屑组织；次要功能归「设置」——Skill 导入为设置·类别内的对话框（skill-packages），提示词版本历史为类别编辑区内的展开项
- `uiStore` 结构调整：`page` 收敛为 `review | settings` 两值；审阅区内部视图态 `reviewView: list | workspace | new`（对应 `activeProjectId`）驱动下钻与面包屑；现三页签壳（新建/工作台/设置）随之重构，「新建审阅」与「开新一轮」共用同一输入组件（首轮无「沿用配置」块）
- 工作台头部加轮次切换条（`[1][2][3*]`）与「本轮 vs 上轮」对比面板入口；对比面板为右侧第三页签（批注/报告/对比），交互契约以 spec 为准
- 疑似遗留并排视图复用 FindingCard 结构双列渲染
- onboarding 落点与 PageId 联合类型随之调整（见任务 2.3）

## Risks / Trade-offs

- [匹配阈值误报/漏报] → spike 任务实测调参；ambiguous 兜底类目承接不确定判定；阈值做成常量便于迭代
- [plugin-sql 无浏览器 fallback] → repo 接口抽象 + 内存实现，`isTauri()` 分流（沿用现有模式）
- [迁移代码写错毁用户数据] → golden fixture 矩阵测试 + 备份原文件 + 每步事务；CI 拦截
- [全关系 schema 演进成本（每加字段必迁移）] → 纪律写入项目规范；纯展示嵌套一律 JSON 列，减少列变更频率
- [finding_links 后台补算的复杂度] → 只在删除轮次时触发、只补算一对；量级小

## Migration Plan

1. 里程碑 0 合入即建立 db 与迁移框架，同版本内完成 json 首迁（用户只升级一次）
2. 回滚策略：新版问题 → 用户回滚旧版（旧版读 json 备份，数据不丢但看不到新轮次）；db 保留，再升级时按 user_version 续接，无需重复首迁
3. 发布前验收必须包含：存量 fixture 升级、双版本往返（升→回滚→再升）两条路径

## Open Questions

- L2 相似度阈值与 confidence 分档的具体取值 —— spike 任务内定，不影响 schema 与接口
- 对比面板放右侧第三页签还是抽屉 —— 实现期视觉走查定，交互契约不变
