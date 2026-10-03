# Design: mvp-implementation

## Context

仓库现状为绿地工程：《产品需求说明书》V1.1 与两份原型（`design/01` 模块数据流、`design/02` 交互原型）已冻结，无任何实现代码。已确认的用户决策：Tauri v2 桌面应用、Vue 3 前端、`@earendil-works/pi-ai` 作为 AI Runtime、文稿上限 30 000 字符。`design/02` 原型中的 `parseBlocks`/`anchorOne`/`hashText` 是三信号定位算法的可运行草稿，全套 CSS design token 可直接迁移。动机见 proposal.md。

## Goals / Non-Goals

**Goals:**

- 一个在 macOS 上可日常使用的 Tauri 桌面应用，跑通「粘贴 → 审阅 → 定位批注 → 报告」全链路
- 领域核心（解析、定位、规范化、去重）为零框架依赖的纯函数，vitest 全覆盖
- API Key 不落明文，日志全链路脱敏

**Non-Goals:**

- 不做 CI/发布流水线、自动更新、多平台适配验证（本地 `tauri dev`/`tauri build` 可用即可）
- 不做多 Review 历史（仅最近一次，spec 已定）
- 不做流式输出的逐 token 渲染（见决策 7）
- 不引入 UI 组件库、不做 i18n（界面中文文案硬编码）

## Decisions

### 1. 应用架构：Tauri v2，pi-ai 跑在 WebView

WebView（前端）承载全部 UI 与业务编排；Rust 壳只提供三件事：免 CORS 的 HTTP 通道（`@tauri-apps/plugin-http`）、系统钥匙串（keyring）、应用数据文件（`tauri-plugin-store`）。

- 备选 A（纯前端 Web）：被否——用户已选桌面形态，且 Key 需要系统安全存储。
- 备选 B（Node sidecar 跑 pi-ai）：被否——多一层进程管理与打包复杂度（sidecar 需捆绑 Node 运行时），pi-ai 官方支持浏览器环境，无必要。

**网络通道细节**：pi-ai 浏览器模式使用全局 `fetch`。在应用入口把 `globalThis.fetch` 替换为 `@tauri-apps/plugin-http` 的 `fetch`（签名兼容，从 Rust 侧发出请求，天然免 CORS、绕过 WebView CSP）。Phase 1 安排 spike 验证 pi-ai + tauri fetch 的组合（含 OpenAI-compatible 端点）；若个别 Provider 直连更稳，允许按 Base URL 白名单走原生 fetch。

### 2. 前端：Vue 3 + TypeScript + Pinia + Vite（`create-tauri-app` vue-ts 模板）

用户已定。Pinia 拆三个 store：`settingsStore`（模型配置、类别）、`sessionStore`（ReviewSession、CategoryRun、Findings、报告）、`uiStore`（当前页、选中 Finding、筛选、分栏宽度）。

### 3. API Key 存储：tauri-plugin-keyring（OS 钥匙串）

ModelConfig 持久化时，apiKey 写入钥匙串（条目 id = 配置 id），JSON 数据文件里只存 `keyringRef`，永不存 Key 明文。运行审阅时前端通过 Tauri command 从钥匙串读 Key 到内存、注入 pi-ai 调用参数；读取走按需短路径，不缓存到任何持久层。

- 备选（stronghold 加密 vault）：被否——多一个密码/口令概念，对单用户个人工具是负担。

### 4. 应用数据：tauri-plugin-store（JSON 文件，app-data 目录）

存：模型配置（脱敏）、类别与 Prompt、当前输入文本、最近一次 Review 完整结果（session/runs/findings/report）、UI 偏好。

- 备选（SQLite via tauri-plugin-sql）：被否——数据量是「一份配置 + 一份最近会话」，JSON 足够且可读可 diff；后续做多历史时再升级。

### 5. Structured Output：pi-ai 的 tool-call + TypeBox schema

定义一个 `submit_findings` 工具（参数即 Finding 数组的 TypeBox schema：severity/title/quote/lineHint/contentHash/problem/reason/suggestion），强制模型以工具调用形式交回结构化结果；TypeBox 校验即 Schema 校验。「自动修复一次」= 带校验错误信息重发一次的补丁调用。归一化与 hash 规则在 Output Schema 文本中向模型说明：归一化 = 去除全部空白字符；hash = 对归一化文本做 djb2 变换取 8 位 hex（与原型 `hashText` 一致）。

- 备选（JSON mode/纯文本解析）：被否——各 Provider 的 JSON mode 能力不齐，tool-call 是 pi-ai 的统一抽象，四类 Provider 行为一致。

### 6. 领域层目录与状态流

```
src/
├── domain/          # 纯函数，零框架依赖，vitest 直接测
│   ├── parser.ts        # parseBlocks：Markdown → Block[]（翻译原型）
│   ├── anchor.ts        # 三信号定位：内容匹配→行号消歧→hash 校验
│   ├── normalizer.ts    # 字段校验/severity 修复/空 quote 丢弃
│   ├── dedup.ts         # 同类去重（quote+类型+problem 相似度）
│   ├── prompts.ts       # 四段 Prompt 组装、行号标注格式、Output Schema 文案
│   ├── errors.ts        # Provider 错误 → 分类（可重试/配置错/超限）
│   └── types.ts         # PRD §60 数据对象
├── ai/              # pi-ai 封装：provider 工厂、submit_findings、重试、脱敏
├── orchestrator/    # 并发池、session/run 状态机、单类重跑、降级、报告触发
├── stores/          # Pinia：settings / session / ui
├── pages/           # NewReview / Workspace / Settings 三页
├── components/      # DocViewer、FindingCard、RunStrip、ReportView…
└── styles/          # 原型 design token 迁移（--paper/--ink/--red…）
```

审阅数据流单向：`orchestrator` 消费 domain 与 ai 层，产出 run/finding 增量写入 `sessionStore`，UI 只读 store 渲染。

### 7. MVP 使用非流式 complete()，流式降为增强

pi-ai 的 `complete()` 一次拿全量结果，规避 tauri fetch 流式（ReadableStream/SSE）兼容性风险；「正在分析……」的分品类进度文案由 Orchestrator 状态驱动，满足 spec 的加载要求。若 Phase 4 联调时验证 tauri fetch 流式可用，再作为增强开启（PRD §50 本就允许）。

### 8. 重叠高亮：块内区间切片 + 原型多层下划线方案

定位算法在 Block 的 plainText 上写区间（startOffset/endOffset）；DocViewer 把块文本按所有命中区间切片渲染，重叠区间叠加多层下划线样式（原型 `.hl.u1/.u2/.u3` 方案），同位置多 Finding 点击弹出列表。样式与交互直接从 `design/02` 迁移。

### 9. 报告生成：一次额外模型调用 + 程序统计

输入 = 文档概要（标题+字数+块统计）+ 全部 Findings 的精简 JSON + 失败类别列表；模型只产 summary、priorityFindingIds（5–10）、每类一句小结；各 severity 计数由程序计算，不依赖模型。报告调用失败时降级为「程序化报告」（纯统计 + 按严重度排序的优先列表），不让报告阶段阻塞结果查看。

### 10. 并发与重试

自实现简单并发池（默认 3，可被 Provider 错误信息修正）；网络类错误（超时/429）自动重试 ≤2（指数退避），配置类错误（401/404/BaseURL 连接失败）不重试，与 spec `ai-runtime` 的分类一致。

## Risks / Trade-offs

- [pi-ai + tauri fetch 组合未经验证（含 streaming、header 注入）] → Phase 1 首个任务就是 spike：用一条真实 OpenAI-compatible 配置跑通 complete()；失败则回退：该 Provider 走 CSP 白名单直连或降级 Node sidecar 方案（仅该场景）
- [globalThis.fetch 替换影响面] → 只在应用入口替换一次；开发模式（纯 vite dev 无 Tauri）保留原生 fetch 以便浏览器调试
- [模型 quote 抄写偏差导致 unanchored 偏多] → Output Schema 强调逐字引用；归一化已忽略空白；unanchored 是产品预期内的兜底态而非错误
- [30k 字符 + 行号 + schema 的 prompt 体积] → 3 万中文 ≈ 5–6 万 token，主流 128k 模型可承载；上下文超限时走降级路径（spec `review-orchestration`）
- [keyring 在开发/打包环境的可用性差异] → Phase 3 spike（macOS 钥匙串读写）；失败兜底：加密文件 + 应用口令（记录为已知限制）
- [报告模型调用失败] → 决策 9 的程序化降级路径

## Migration Plan

绿地工程，无迁移。按 tasks.md 的 Phase 顺序交付，每个 Phase 结束时应用处于可运行状态（Phase 1 起 `tauri dev` 可启动，Phase 6 起全链路可用）。回滚 = 整个工作目录回退，无数据兼容负担。

## Open Questions

（无——pi-ai/tauri fetch 组合与 keyring 可用性两个不确定点均已转为 Phase 1/3 的 spike 任务，不改变结构与任务拆分。）
