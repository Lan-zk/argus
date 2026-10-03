# Argus — AI 文稿审阅

个人使用的 AI 文稿审阅桌面应用（MVP）。粘贴文稿 → 选择审阅类别 → 多类别并行 AI 审阅 → 原文高亮定位与批注 → 汇总报告。

技术栈：**Tauri v2 + Vue 3 + TypeScript + Pinia + Vite**，AI Runtime 为 `@earendil-works/pi-ai`（运行于 WebView，模型请求经 Tauri http 插件从 Rust 侧发出，免 CORS）。需求基线见《产品需求说明书.md》，规格见 `openspec/changes/mvp-implementation/`。

## 本地运行

依赖：Node ≥ 22、Rust（stable）、macOS（Xcode Command Line Tools）。

```bash
npm install
npm run tauri dev     # 开发模式：编译并打开应用窗口
```

纯前端调试（浏览器，无 Tauri 外壳）：

```bash
npm run dev           # http://localhost:1420，持久化与钥匙串走内存兜底
```

## 测试与打包

```bash
npm run test          # vitest 全量单测/组件/集成测试
cargo test            # Rust 侧测试（含 macOS 钥匙串读写往返）
npm run tauri build   # 产出 .app 与 .dmg
```

产物位置：

- `src-tauri/target/release/bundle/macos/Argus.app`
- `src-tauri/target/release/bundle/dmg/Argus_0.1.0_aarch64.dmg`

## 模型配置指引

1. 打开 **设置 → Models 模型配置 → ＋ 新增模型配置**。
2. 选择 Provider 并填写：

| 字段 | 说明 |
| --- | --- |
| Provider | OpenAI / Anthropic / Google / OpenAI-compatible |
| Model Name | 如 `gpt-4o`、`claude-sonnet-4-5`、`glm-4.7` |
| API Key | 保存进 **macOS 钥匙串**（数据文件只存引用，不落明文）；预设服务唯一必填项 |
| Base URL | 仅自定义连接需要（如 `https://open.bigmodel.cn/api/paas/v4`）；预设自动内置 |
| Temperature / Max Tokens / Context Window | 可选；Context Window 用于超长文稿的降级判定 |

3. 推荐走**预设快速配置**：选一个预设服务（DeepSeek / Kimi / 智谱 / MiniMax / 阿里 Qwen / OpenAI / Anthropic / Google / OpenRouter 等 34 个）→ 只粘贴 **API Key** 一项 → 离开输入框自动检索模型列表（含离线静态目录与推荐默认）→ 下拉选模型保存。同一服务加第二个模型时自动复用已存 Key。
4. 任意 OpenAI-compatible 端点（含 Ollama / LM Studio 等本地服务）走 **自定义连接**：填 Base URL + Key，可一键「检索模型」或手动输入模型 ID。
5. 点击 **测试连接**：成功显示模型信息；失败显示可读错误与下一步检查建议。
4. 回到 **新建审阅**：粘贴文稿（≤ 30 000 字符）→ 勾选类别 → **开始审阅**。

内置 6 个默认启用类别（逻辑 / 论点 / 论证 / 修辞 / 结构 / 清晰度）与 1 个默认禁用类别（演讲表达），Prompt 均可在设置中修改，修改互不影响，可单类重跑。

## 架构速览

```
src/
├── domain/        # 纯函数领域核心：解析、三信号定位、规范化、去重、Prompt 组装、错误分类
├── ai/            # pi-ai 封装：provider 工厂、submit_findings 工具、自动修复、重试、测试连接、长文降级
├── orchestrator/  # 并发池、会话状态机、单类重跑、报告生成
├── stores/        # Pinia：settings / session / ui
├── pages/         # NewReview / Workspace / Settings 三页
├── components/    # DocViewer（块渲染+重叠高亮）、FindingCard、ReportView
├── lib/           # tauri 环境与 fetch 通道、钥匙串封装、持久化（plugin-store）
└── styles/        # design token（迁移自 design/02 原型）
src-tauri/src/     # Rust 壳：http / store 插件 + 钥匙串 command
```

定位三信号：**行号 + 内容 + hash**——模型返回的 quote 归一化后全文检索，多候选按 lineHint 消歧，再对定位结果做 hash 校验（djb2 8 位 hex）；任何单一信号不独立信任。无法定位的 Finding 保留为 unanchored（右侧显示、左侧不高亮）。

## 已知限制（MVP）

- 端到端联调已在应用内以本地 OpenAI-compatible 端点全链路验证（见 `docs/known-issues.md`）；连接真实云服务（OpenAI/Anthropic/Google 等）前请在「设置 → Models」用「测试连接」确认；首次在 GUI 下访问钥匙串时 macOS 可能弹出授权确认。
- 不做：多 Review 历史、流式逐字渲染、项目/版本管理、事实核查（PRD §4、§70）。
