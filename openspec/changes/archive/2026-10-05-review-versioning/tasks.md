# review-versioning — 任务清单

## 1. 里程碑 0 — 存储地基

- [x] 1.1 添加 `tauri-plugin-sql`（Cargo + package.json + capabilities），验证 Tauri 构建下可打开/创建数据库；确认 `sqlite:` 路径由插件解析的基目录（config dir vs data dir）并使实际位置与 spec「应用数据目录」一致；评估升级首启「建库+首迁」在 mount 前（`settings.init()` 供主题首帧）执行的冷启动时延，必要时把首迁移出关键路径并保证主题无闪烁
- [x] 1.2 编写迁移 `v1.ts` 建 schema v1 全表：model_configs、categories（**含 `current_version` 列**）、category_prompt_versions、app_prefs、projects、rounds、documents（**含 `source_meta` 列**）、document_blocks、runs、findings、reports、finding_links（**自增行主键 + 两索引，无复合唯一键**）及全部索引——两个下游 change（document-import / skill-packages）依赖的字段在本步一次建出；定义 repo 接口（open、迁移执行、实体级读写）与内存实现，接口契约单测在内存实现上全绿
- [x] 1.3 **spike：迁移原子性方案定稿**——tauri-plugin-sql（sqlx 连接池）JS 侧无法保证 BEGIN/COMMIT 连接亲和；二选一并记录结论：A（推荐）Rust 侧通用 `execute_batch` 单连接事务命令；B 每步幂等 DDL（IF NOT EXISTS）+ user_version 最后写；据此实现迁移执行器（按 D3），失败可重试不落半成品
- [x] 1.4 实现 SQLite repo；实体契约单测（同一套测试跑内存与 SQLite 两实现）全部通过，含 API 面断言：findings/documents/reports 完成后除「单类重跑（DELETE+INSERT+级联重算 links 与报告）」外无任何改写方法
- [x] 1.5 settings 迁移：`model_configs`/`categories`（含 prompt v1 版本行）/`app_prefs` 读写替换 `persistence.ts` 的 settings 链路；移除 plugin-store 依赖（含 `src-tauri/capabilities/default.json` 的 `store:default` 权限移除、`src/lib/README.md` 与 `src/stores/README.md` 文档更新）；`loadState/saveSettings` facade 去留定案并适配 6 个消费测试（App/settings/onboarding/persistence/NewReviewPage/SettingsPage.test.ts）；`npm test` 全量回归通过
- [x] 1.6 首迁实现（副本式备份）：检测原路径 `argus-store.json` 且库内无完成标记 → 拆包入库（settings 全量、**复刻 loadState 默认合并与 onboarding 老数据启发式**、`lastReview` → 「导入的审阅」项目 Round 1 全套）→ 成功后复制备份 + 写完成标记；任何失败原文件不动、可重试；用脱敏 golden fixture 单测覆盖成功、中途失败重试、重复启动不重复迁移三条路径
- [x] 1.7 user_version 迁移执行器 + 降级只读保护（db 版本高于应用 → 只读开关 + 提示）；fixture 迁移矩阵测试（每个历史版本 → latest）挂入 CI；「触及存储必须带迁移+fixture」纪律写入 `openspec/config.yaml` operations guidance；`npm run build` 通过
- [x] 1.8 里程碑验收：模拟存量用户升级（fixture json → 全部数据可见于新库）、双版本往返（升→回滚：旧版仍可读原路径 json→再升级：按完成标记续接）不丢数据

## 2. 里程碑 1 — 项目与轮次

- [x] 2.1 `types.ts` 新增 Project/Round 及快照结构；orchestrator 改造为「项目下创建 Round N」，`PersistedReview` 拆解为分表写入；`resume()` 从轮次快照恢复 `activeCategories/activeModelConfig`（修复现存隐患：重启恢复后重跑触发报告时类别集合丢失）；单测覆盖一轮完整落库与恢复后重跑
- [x] 2.2 SessionSink 双写（Pinia + repo 逐条 INSERT/UPDATE）；同步 void 接口异步化的波及面处理（orchestrator 全部 sink 调用点、orchestrator.test.ts / pool.test.ts 自定义 sink 适配）；崩溃恢复：启动发现 running 悬挂轮次 → 标 partial_failed 并可查看部分结果；单测覆盖中断恢复
- [x] 2.3 审阅列表页与顶层信息架构重构：`uiStore` 收敛为 `review | settings` 两页签 + 审阅区内部视图态（list/workspace/new）与面包屑下钻；「新建审阅」与「开新一轮」共用输入组件（onboarding `complete()` 落点与 PageId 联合类型随两页签调整，注意 onboarding spec「完成后落点」的表述衔接）；启动恢复改为 `lastActive` 位置，无记录落列表页；组件测试覆盖列表操作与下钻返回
- [x] 2.4 **手动编辑提示词版本化**（评审提前项）：settings store `updateCategory` 在 prompt 变更时「INSERT manual_edit 版本 + 前移 current_version」，其余字段原地更新；`duplicateCategory` 复制时种 v1=源当前版本、恢复内置类别追加 builtin 版本（与 skill-packages 的 append-only 语义一致）；单测覆盖编辑追加、复制、恢复内置
- [x] 2.5 里程碑验收：两个项目各三轮的端到端流程（建→审→中断恢复→续审→改提示词→版本历史追加（新一轮默认沿用上轮版本；显式升级入口属里程碑 2/3 配置面板）），重启后位置与数据完整

## 3. 里程碑 2 — 对比引擎

- [x] 3.1 抽取 `src/domain/normalize.ts`（parser/anchor/diff 共用，替换散落三处的归一逻辑）；基于 `diff`（jsdiff 包名）实现块级 diff 与位置映射表；单测覆盖改词/改句/挪段三粒度
- [x] 3.2 L1 即时检查：旧 findings quote 模糊匹配 → `finding_links`（unresolved/edited/ambiguous），文档确认后即时计算写入；单测覆盖三类判定与边界（空白/标点级小改不误判）
- [x] 3.3 L2 疑似遗留：审阅完成后计算 recurring + confidence（hash 精确 → 位置邻近 + 文本相似度合成，允许一个旧问题对应多条新 finding）；spike 用真实文档三粒度样本调阈值并记录结论于常量；单测覆盖高/低置信两档与多对一
- [x] 3.4 配置沿用与级联：开新一轮默认复制上轮快照配置（全新项目首轮用默认模型+当前提示词），任何改动记 `config_changed`；删除轮次触发相邻对 links 补算；轮内单类重跑级联作废重算该轮 links 与报告；单测覆盖沿用、变更标记、删轮补算、重跑级联

## 4. 里程碑 3 — 对比 UI

- [x] 4.1 工作台轮次切换条（按序号切换，查看历史轮次只读数据）；「重新分析」改为开新一轮（不覆盖既有轮次）；组件测试覆盖切换与首轮空态
- [x] 4.2 「本轮 vs 上轮」对比面板：去向统计（确定性标注）+ 本轮构成（疑似遗留附置信度/新问题）+ 点击跳转 Finding；`config_changed` 时显示「配置已变更，对比仅供参考」
- [x] 4.3 疑似遗留并排视图（两轮标题/引用/建议双列）；措辞为概率性表述（无断言式文案）；组件测试覆盖数据渲染与空态
- [x] 4.4 收尾：`rerunCategory` 冻结版本语义与级联重算回归测试；全量验收 `npm test`、`npm run build`、fixture 矩阵、四主题组合下新页面截图目检

## 5. 验收后打磨（用户实测反馈 + impeccable 评审）

- [x] 5.1 三栏布局：左侧审阅列表常驻（可折叠，状态持久化）+ 中原文/右批注；顶栏极简（☰ 折叠/项目名/设置）
- [x] 5.2 impeccable critique 双子代理评审（25/40）+ P1/P2 修复：轮次条样式缺失（M1 注入静默失败）、swiss-light 对比度、--ok/--danger 语义令牌与死 fallback 清理、side-stripe 4 处、新 UI 键盘可达与 aria、文案中文化与去规格化；检测器 35→15，contrast-check 全绿
- [x] 5.3 软删+撤销（deletion store，8 秒窗口，替代两套删除确认）+ 取消审阅（cancelReview 接 AbortController）
- [x] 5.4 键盘快捷键：Cmd/Ctrl+Enter 开始审阅、Cmd/Ctrl+B 折叠侧栏、1/2/3 右栏页签、j/k 卡片导航
- [x] 5.5 轮次摘要：页签 tooltip 与轮次条显示「上轮 N 个问题 · M 已修改」（L1 数据复用）
- [x] 5.6 真 bug 修复：findings.id 全局主键轮间碰撞（f1 互相 OR IGNORE 吞数据）→ 会话前缀唯一化；软删 commit 相邻位补算元信息直传
