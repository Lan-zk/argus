# Tasks: mvp-implementation

依赖顺序执行；每个 Phase 结束应用保持可运行。规格引用写作 `spec:<capability>`。

## 1. 脚手架与关键 Spike

- [x] 1.1 用 create-tauri-app（vue-ts 模板）初始化工程：Tauri v2 + Vue 3 + TS + Vite，验证 `tauri dev` 启动出窗口
- [x] 1.2 安装并配置依赖：`@earendil-works/pi-ai`、pinia、`@tauri-apps/plugin-http`、tauri-plugin-store、tauri-plugin-keyring（Rust 侧）、vitest；验证 `npm run test` 空跑通过且 `tauri dev` 仍正常
- [x] 1.3 Spike（go/no-go）：应用入口将 `globalThis.fetch` 替换为 tauri http fetch，用一条真实 OpenAI-compatible 配置经 pi-ai `complete()` 完成一次调用；验证返回文本。失败则按 design 风险表启动回退路径并记录结论（应用内真实通道验证 GO，见 docs/known-issues.md）
- [x] 1.4 迁移 `design/02` 的 design token 与基础样式到 `src/styles/`，搭建三页骨架（NewReview / Workspace / Settings + 顶部导航）；验证三页可切换且视觉与原型一致

## 2. 领域核心（纯函数 + vitest）

- [x] 2.1 实现 `src/domain/types.ts`：PRD §60 全部数据对象的 TS 类型；验证类型被后续模块引用无报错
- [x] 2.2 实现 `parser.ts`（翻译原型 `parseBlocks`）：块类型识别、空行分组、稳定 ID、order、起始行号、rawText/plainText；单测覆盖 heading/quote/code/list/other、行号正确性、空行分组（spec:document-parsing 全部场景）
- [x] 2.3 实现 `normalizer.ts`：必填字段校验、空字段清理、非法 severity 修复、空 quote 丢弃并记日志；单测覆盖 spec:finding-pipeline 规范化两场景
- [x] 2.4 实现 `anchor.ts` 三信号定位：归一化内容匹配收集候选 → 行号消歧 → hash 校验（djb2 8 位 hex，与原型一致）→ 写入 blockId/区间；单测覆盖唯一命中、多候选消歧、行号错误以内容为准、hash 不一致记日志、无命中标 unanchored、重叠区间共存（spec:finding-pipeline 定位与 unanchored 场景）
- [x] 2.5 实现 `dedup.ts`：同类内 quote+类型+problem 相似合并、跨类不合并；单测覆盖两场景（spec:finding-pipeline 去重）
- [x] 2.6 实现 `prompts.ts` 四段组装：System Instruction（含 §66 十条公共规则）、Category Prompt 插槽、Output Schema 文案（quote/lineHint/contentHash 字段、归一化与 hash 规则说明）、带行号全文（`L{n}|` 前缀）；单测验证组装包含四段且改一类别不影响他类（spec:ai-runtime Prompt 两场景）
- [x] 2.7 实现 `errors.ts` 错误分类：四类 Provider 错误映射到 spec:ai-runtime 的九类错误（可重试/配置错/超限三组）；单测覆盖 401/404/超时/429/上下文超限的映射与可读文案、Key 脱敏

## 3. 持久化层

- [x] 3.1 Spike：Rust command 封装钥匙串读写（tauri-plugin-keyring）；验证真实写入后 macOS 钥匙串可见条目且读取往返一致
- [x] 3.2 实现 settings 持久化（tauri-plugin-store）：模型配置（仅 keyringRef 不含 Key）、类别与 Prompt、当前输入文本、UI 偏好（分栏宽度）；验证重启应用后全部恢复（spec:app-persistence 保存范围）
- [x] 3.3 实现最近一次 Review 的保存与恢复：完成审阅后持久化 session/runs/findings/report，重启显示恢复提示条与「清除并新建」；验证 spec:app-persistence 两恢复场景
- [x] 3.4 实现 API Key 安全存取封装：保存写钥匙串、编辑界面脱敏回显、运行时经 command 短路径读取注入调用；验证数据文件 grep 不到 Key 明文、日志与错误无完整 Key（spec:app-persistence 安全两场景）

## 4. AI Runtime 集成

- [x] 4.1 实现 pi-ai provider 工厂：按 ModelConfig 构建 OpenAI / Anthropic / Google / OpenAI-compatible（自定义 baseUrl/model/apiKey）；验证四种配置各完成一次最小调用（spec:ai-runtime Provider 场景，可用一条真实 + 三条 mock header 校验）
- [x] 4.2 实现 `submit_findings` 工具与调用封装：TypeBox schema 定义 Finding 数组、tool-call 返回、参数校验即 Schema 校验；验证合法返回通过、非法字段被拒
- [x] 4.3 实现自动修复一次：校验失败带错误反馈重发一次，仍失败抛「Structured Output 无效」；验证两失败场景（spec:ai-runtime Structured Output 场景 2/3）
- [x] 4.4 实现重试策略：网络类（超时/429）指数退避自动重试 ≤2，配置类不重试；单测覆盖（spec:ai-runtime 重试两场景）
- [x] 4.5 实现测试连接：成功返回模型信息、失败返回分类可读错误与下一步建议；验证成功/坏 BaseURL/坏 Key 三条路径（spec:settings 测试连接两场景）
- [x] 4.6 实现长文降级：token 估算超限判定、文档结构表示生成器（标题层级+行号索引+段落首句、不截断句子）；单测覆盖触发与段落边界（spec:review-orchestration 降级两场景）

## 5. Orchestrator

- [x] 5.1 实现并发池（默认 3）与 CategoryRun 状态机（pending/running/completed/failed）；单测验证 6 任务并发不超过上限
- [x] 5.2 实现单类执行管道：选类别 → prompt 组装 →（超限则降级）→ 调用 → normalizer → anchor → dedup → findings 写入 store，完成即发布；验证先完成类别先可见（spec:review-orchestration 完成即显示）
- [x] 5.3 实现失败隔离与整体状态判定：单类失败不中断他类，全部终态后判 completed/partial_failed/failed；集成测试覆盖（spec:review-orchestration 状态机两场景）
- [x] 5.4 实现单类重跑：删该类旧 findings、用最新 Prompt 与当前模型配置重执行、完成后重生成报告；集成测试验证他类不受影响（spec:review-orchestration 重跑两场景）
- [x] 5.5 实现报告生成：文档概要+findings 精简 JSON+失败列表 → 模型产 summary/priorityFindingIds/每类小结，计数程序计算，优先问题必须关联已有 Finding 且 5–10 条；调用失败降级为程序化报告；单测覆盖输入约束与降级（spec:review-report 全部场景）
- [x] 5.6 Orchestrator 端到端集成测试：用 pi-ai faux provider（或等价 mock）模拟成功/失败/超时/超限组合，验证状态机、隔离、重跑、报告触发链路

## 6. UI 三页

- [x] 6.1 NewReview 页：大输入区、字符计数与 30 000 上限、类别复选框（默认选中来自设置）、全选/清空/恢复默认、三项前置校验错误列表；验证 spec:review-ui 输入/选择/校验场景
- [x] 6.2 Workspace 骨架：双栏 60/40、可拖动分隔线且宽度持久化、左右独立滚动互不牵动页面；验证 spec:review-ui 布局场景
- [x] 6.3 DocViewer：基于块模型渲染 Markdown（标题/引用/列表/代码）、行号显示、只读；高亮按区间切片渲染、重叠多层下划线、unanchored 无高亮；验证渲染保留结构场景
- [x] 6.4 双向定位交互：点高亮→右侧面板内滚动选中卡片（左侧滚动不动）、多 Finding 弹列表、点卡片→左侧面板内滚动居中高亮（右侧滚动不动）、hover 双向临时强调；验证 spec:review-ui 定位四场景
- [x] 6.5 Finding 面板：卡片七要素、Category+Severity 双筛选同时生效、unanchored 虚线标注、空态文案；验证卡片与筛选场景
- [x] 6.6 运行状态条与加载反馈：逐类状态与计数、失败类重跑按钮、分析中文案非单一 spinner；验证状态展示与加载场景
- [x] 6.7 ReportView：总体摘要/优先问题/Category Summary（含失败类标注）/完整 Findings 四部分、点击条目回跳工作台；验证 spec:review-report 内容与回跳场景
- [x] 6.8 Settings 页：模型 CRUD+默认+测试连接（可读错误）、类别 CRUD/启停/默认选中/排序/复制/Prompt 编辑器（上下文变量提示）、内置 7 默认类别种子数据；验证 spec:settings 全部场景

## 7. 内容、联调与交付

- [x] 7.1 撰写 7 个默认类别的正式 Prompt（基于原型 DEFAULT_CATS 扩写：检查项、severity 判断规则、引用与 hash 规则引用）；验证每条 Prompt 经真实模型返回可定位 findings
- [x] 7.2 端到端联调：真实模型配置跑通「粘贴样例文 → 6 类并行 → 高亮定位 → 筛选 → 报告 → 重跑单类 → 刷新恢复」全链路；记录已知问题清单（应用内全链路通过，已知问题见 docs/known-issues.md）
- [x] 7.3 交付检查：vitest 全绿、`tauri build` 产出可运行 .app、README（本地运行/打包/模型配置指引）；验证三条命令逐一执行通过
