# Change: mvp-implementation

## Why

《产品需求说明书》V1.1 与两份设计原型（模块数据流图、交互原型）已完成并冻结，但仓库中尚无任何实现代码。本次 change 将 MVP 从零落地为一个可日常使用的个人 AI 文稿审阅桌面应用：粘贴文稿 → 选择审阅类别 → AI 基于全文审阅 → 三信号定位的原文高亮与批注 → 汇总报告。

## What Changes

- 新建 Tauri v2 桌面应用工程：Vue 3 + TypeScript + Pinia + Vite 前端，Rust 壳，视觉规范直接采用原型的瑞士国际主义设计 token
- 集成 `@earendil-works/pi-ai` 作为唯一 AI Runtime（运行于 WebView，模型请求经 Tauri http plugin 发出，免 CORS）
- 实现完整审阅流水线：文档解析 → 四段 Prompt 组装 → 并行 Category 执行 → Structured Output 校验 → 三信号定位 → 去重 → 工作台展示 → 汇总报告
- 内置 6 个默认启用 + 1 个默认禁用的 Review Category（逻辑/论点/论证/修辞/结构/清晰度/演讲表达）及其正式 Prompt
- 领域核心算法（解析、三信号锚定、规范化、去重）以纯函数实现并带 vitest 单测
- 固化已确认的参数决策：文稿上限 30 000 字符（超限走结构化降级）、并发上限默认 3、网络类错误自动重试 ≤2、API Key 存系统钥匙串不落明文、应用数据以 JSON 文件持久化并支持恢复最近一次 Review

## Capabilities

### New Capabilities

- `document-parsing`: Markdown 原文解析为 Document 与 DocumentBlock（稳定 ID、类型识别、行号索引），作为渲染与定位的统一基准
- `ai-runtime`: 基于 pi-ai 的模型调用层——Provider/模型配置、四段 Prompt 组装、Structured Output 校验与自动修复、Streaming 展示策略、错误分类与重试
- `review-orchestration`: ReviewSession 与 CategoryRun 的生命周期管理——并行执行、并发控制、单项失败隔离、单类重跑、整体状态判定与报告触发
- `finding-pipeline`: Finding 的后处理流水线——规范化校验、行号+内容+hash 三信号定位（含 unanchored 处理）、同类别内去重
- `review-ui`: 三个页面的界面行为——New Review 输入与前置校验、双栏工作台（只读原文渲染、重叠高亮、双向定位、双筛选、分栏拖动）、加载/空/失败状态
- `review-report`: 汇总报告的生成时机、输入约束、四部分内容与回跳交互
- `settings`: Models 配置（增删改、默认、测试连接）与 Review Category 管理（含 Prompt 编辑器）
- `app-persistence`: 应用状态持久化（配置、最近一次 Review 的恢复）与 API Key 安全存储

### Modified Capabilities

（无——全新仓库，`openspec/specs/` 当前为空）

## Impact

- **代码**：整个应用从零创建——前端 `src/`（Vue/Pinia/领域层）、Rust 壳 `src-tauri/`；不触碰任何现有运行系统（绿地工程）
- **依赖**：`@earendil-works/pi-ai`（AI Runtime）、Vue 3 / Pinia / Vite（前端）、Tauri v2 插件（http 免 CORS 请求、store 数据文件、keyring 钥匙串）
- **现有资产**：`design/02-产品交互原型.html` 的定位算法草稿（`parseBlocks`/`anchorOne`/`hashText`）与全套 CSS design token 作为实现参考直接翻译；《产品需求说明书.md》保持为需求基线，本 change 的 specs 以其为唯一来源
- **范围边界**：PRD §4 非目标与 §70 暂缓功能全部不做；不含 CI/发布流水线（本地 `tauri dev` / `tauri build` 可用即可）
