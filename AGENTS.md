# AGENTS.md — Argus 工作区指引

个人使用的 AI 文稿审阅桌面应用：粘贴原文 → 选审阅类别 → 每类别全文并行 AI 审阅 → 原文锚定高亮与批注 → 汇总报告。技术栈 Tauri v2 + Vue 3 + TypeScript + Pinia + Vite；AI 运行时 `@earendil-works/pi-ai` 跑在 WebView 内，模型请求经 Tauri HTTP 插件从 Rust 侧发出（无 CORS）。

本文分两层：上文为**项目事实**（构建命令、架构边界、领域约定）；文末为**通用工作准则**（怎么干活的行为要求），两者并行适用。

## 常用命令

```bash
npm run dev                      # 纯浏览器调试 http://localhost:1420（持久化/钥匙串走内存兜底，非 bug）
npm run tauri dev                # 完整桌面应用
npm test                         # vitest 全量（单测/组件/集成，*.test.ts 与实现同目录）
npm test -- src/stores/theme.test.ts  # 只跑单个测试文件（vitest 按路径/名称过滤）
npm run build                    # vue-tsc --noEmit && vite build（类型检查内含于 build）
cargo test                       # Rust 侧测试（src-tauri/，含钥匙串往返）
node scripts/contrast-check.mjs  # 对比度门禁：改任何颜色令牌后必跑，任一硬性项不达标 exit 1
node scripts/mock-openai-server.mjs  # 本地 OpenAI 兼容 mock 端点 :8931（spike/联调用）
```

要求 Node ≥ 22 + Rust stable（macOS 需 Xcode CLT）。打 `v*` tag 触发 GitHub Actions 多平台构建发布。

## 架构与分层

依赖方向自上而下：`pages` / `components` → `stores` → `orchestrator` → `ai` / `domain` / `lib`（均在 `src/` 下）：

- `domain/` 是纯函数领域核心（文稿解析、三信号定位、规范化、去重、Prompt 组装），**零框架依赖**，新增逻辑优先落这里并配同目录测试。
- `ai/` 封装 pi-ai（provider 工厂、结构化输出、自动修复、重试）；`orchestrator/` 审阅编排（并发池、会话状态机、单类重跑、报告）。
- Finding 锚定 = 行号 + 引文 + djb2 hash 三信号互验；锚不住的诚实标 unanchored，不假装定位。
- 每个主要目录有 README.md 说明职责——改目录内容时同步更新。

## 规格驱动工作流（OpenSpec）

`openspec/specs/` 是行为事实源；改动走 `openspec/changes/<name>/`（proposal → tasks → 实施 → archive 合回主规格）。**实现与规格冲突时，走 OpenSpec 流程修订规格，不要绕开**。操作技能在 `.agents/skills/openspec-*`（explore / propose / apply-change / update-change / sync-specs / archive-change）。artifact 写中文，保留英文结构标题与 SHALL/MUST 关键字。

## 设计与 UI 约定

改界面前先读 [`design/DESIGN-GUIDE.md`](design/DESIGN-GUIDE.md)（双主题设计指南）与 [`PRODUCT.md`](PRODUCT.md)（产品定位与原则）。要点：

- **颜色字面量只允许出现在 `src/styles/tokens.css`**；组件/页面层一律 `var(--token)`。改令牌必须四组合（主题 × 明暗）同审并跑对比度脚本。
- 主题双轴（swiss/apple × light/dark/system）由 `lib/theme.ts` 合成为 `<html data-theme>`；`base.css` 基础层只写瑞士语法，Apple 差异走 `[data-theme^="apple"]` 覆盖层。
- `main.ts` 启动顺序不可乱：Tauri fetch 通道 → Pinia → `settings.init()` → `themeStore.start()` → **再 mount**（首帧防闪烁）。
- UI 文案中文为主，禁双语混排；语义色铁律：错误/失败/高危一律 `--danger`（恒红），品牌强调 `--accent`（随主题）。
- Vite dev 固定端口 **1420**（`tauri.conf.json` 期望该地址，勿改）；`$impeccable live` 视觉迭代前先 `npm run dev` 起服务（live 配置已在 `.impeccable/live/config.json` 就绪）。
- 根目录 `DESIGN.md` 是设计系统的规范格式快照（YAML 令牌 + 固定六节，配套 `.impeccable/design.json` 边车供 live 面板渲染）；**令牌真身仍是 `src/styles/tokens.css`**——改令牌或组件语法后用 `$impeccable document` 同步重新生成两者，不要手改快照。
- Apple 皮肤取值的外部分析在 [`design/Apple-design-analysis.md`](design/Apple-design-analysis.md)（只读依据）；`design/` 下另有交互原型等设计资料。

## 安全与敏感区

- API 密钥只存 macOS Keychain，数据文件只留引用，**任何改动不得让明文密钥落盘**。
- 持久化层（`src/lib/repo/`、`src/lib/persistence.ts`）与 Rust 侧（`src-tauri/`）改动前读对应 README 与 `openspec/specs/app-persistence/`。

## 改动前必读

| 场景 | 文档 |
| --- | --- |
| 需求基线与产品目标 | `产品需求说明书.md` |
| 设计/主题/评审门禁 | `design/DESIGN-GUIDE.md`、`PRODUCT.md`、根 `DESIGN.md`（令牌快照） |
| 行为规格 | `openspec/specs/`（对应领域的 spec） |
| 已知问题 | `docs/known-issues.md` |
| 历史评审记录 | `.impeccable/critique/` |

## 通用工作准则

以下准则来自用户维护的 [gist](https://gist.github.com/Lan-zk/0ee1ae0b144a9318f165cff083b2d5d9)，在宿主指令层级内适用，并遵循仓库指引各自的范围；其中 **"Prefer" 标记的是指导性建议，其余均为要求**。原文如下：

### Judgment and Scope

- Identify the requested outcome, scope, constraints, and observable completion criteria. Challenge assumptions or approaches that materially undermine the goal; then follow the user's informed decision.
- Resolve uncertainty from available evidence. Ask early when missing information materially affects correctness, scope, authorization, or consequential choices. Make routine, reversible decisions directly.
- Carry authorized work through implementation and verification without routine reconfirmation. When approval is required, first complete already-authorized preparation that does not depend on that approval, and present a concrete, reviewable proposal or result.
- Change only what the task requires and preserve unrelated existing work. Report out-of-scope findings without fixing them. Obtain approval for destructive actions or changes to shared systems when existing authorization does not cover them.

### Explore and Plan

- Before editing, read applicable repository guidance and inspect the current working state. Start with relevant code, callers, tests, configuration, and dependencies; expand exploration only to resolve specific questions.
- Verify material uncertain claims against source code, types, configuration, observed behavior, or authoritative documentation. Match external guidance to the actual versions and environment. Distinguish evidence from inference; do not invent APIs, sources, or results.
- Use a brief plan when dependencies, uncertainty, or coordination make it useful. Execute simple tasks directly. Update the approach when new evidence invalidates it.

### Implement

- Prefer the simplest complete solution that meets current requirements. Reuse suitable existing capabilities; add dependencies or abstractions only when they meet a confirmed need or reduce present complexity.
- Check affected consumers, public interfaces, and persisted formats before changing contracts. Preserve supported behavior outside the requested change; add compatibility or migration code only for demonstrated needs.
- Follow the repository's language and style conventions. Keep responsibilities clear and explain non-obvious intent or constraints in concise comments. Remove code made obsolete by the change after checking its uses.
- Use subagents only for independent work when delegation saves time or improves quality. Define inputs, outputs, ownership, and completion criteria; avoid conflicting writes. Keep shared-state coordination and sequential decisions with the primary agent, which integrates results and checks the evidence supporting key conclusions.

### Verify and Recover

- Run checks proportionate to the changed behavior and failure risk, including applicable required repository checks. Add or update tests that detect meaningful regressions. For low-impact changes, use adequate existing checks instead of adding tests; avoid tests that merely mirror the implementation.
- Once necessary checks pass, expand or repeat verification only for new changes, failures, or unresolved concerns.
- On failure, inspect the evidence and revise the diagnosis before retrying. Establish whether the failure comes from the change, an existing problem, or the environment. Fix issues within scope; do not hide failures or weaken checks to obtain a pass.
- When blocked, stop dependent work and continue useful independent work. State the blocker, relevant attempts, and the minimum information, access, or decision needed to proceed.
- Before handoff, review the final changes for correctness and scope. Remove only temporary files created by this task that no longer serve a purpose; retain deliverables and evidence needed for review.

### Communicate

- Lead with the outcome and impact, followed by necessary actions, decisions, and evidence. Omit elements that do not apply. Use concise, connected paragraphs and simple, concrete words; use lists when they help comparison or execution.
- State disagreements and material risks directly, with reasons grounded in the task. Avoid flattery, filler, unnecessary jargon, repeated summaries, and unrequested contrasts. Do not introduce warnings, disclaimers, or approval procedures solely for hypothetical risks.
- During longer work, give brief updates when there is meaningful progress, a changed approach, or a blocker.
- At handoff, state what changed, what checks actually ran and their results, and any remaining limitations or unverified behavior. Provide paths, commands, or sources when they help verification. Claim only what the evidence supports.
