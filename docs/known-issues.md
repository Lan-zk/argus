# 联调验证记录（tasks 1.3 / 7.2）

日期：2026-10-03 · 构建版本：debug（tauri dev，Argus 0.1.0）

## 验证方式

应用内置开发联调钩子（`src/lib/dev-spike.ts`，仅 debug 构建生效）在**真实 WebView + 真实 `globalThis.fetch` → Tauri http 插件通道 + 真实产品代码路径**（provider 工厂 → 四段 Prompt 组装 → pi-ai `complete()` → Structured Output 校验 → 规范化 → 三信号定位 → 去重 → Orchestrator → 报告 → 持久化）上执行全链路。模型端点为本地 OpenAI-compatible 服务（`scripts/mock-openai-server.mjs`，SSE 流式 + `submit_findings`/`submit_report` 工具调用，等价 vLLM/Ollama 类自建端点），Key 走真实 macOS 钥匙串存取。

## 任务 1.3 结果：GO

| 项 | 结果 |
| --- | --- |
| 应用入口 `globalThis.fetch` 替换为 tauri http fetch | 生效（模型请求经 Rust 通道发出） |
| pi-ai `complete()` 一次真实调用并验证返回文本 | ✅ `singleCall.ok=true, returnedText=true` |
| Structured Output（submit_findings 工具调用） | ✅ 返回 2 条 findings |
| 结论 | **go**，无需回退路径（CSP 白名单直连 / Node sidecar 均不需要） |

## 任务 7.2 结果：全链路通过

- **并行**：6 类别全部 `completed`（并发池默认 3），逐类 findings 计数正常
- **定位**：12 条 findings = 6 anchored + 6 unanchored；unanchored 为 mock 故意引用错误内容触发，按 spec 右侧显示、左侧不高亮
- **卡片**：全部 findings 七要素完整（`cardComplete=true`）
- **筛选**：逻辑 + 严重 交集结果正确（1 条）
- **报告**：自动生成；优先问题 5 条且全部可追溯到已有 Finding；6 个类别小结；无失败类别
- **重跑单类**：仅逻辑类别 findings 被替换，其他类别不受影响，报告重新生成
- **刷新恢复**：重启后 session/12 条 findings/报告/原文全部恢复，恢复提示条显示；「清除并新建」后回到空白状态
- **安全**：应用数据文件 grep 不到 Key 明文；钥匙串条目随模型删除而清除，无残留

## 已知问题清单

1. **http 插件 capability 范围曾拦截非标准端口**（已修复）：`http://**` 模式不匹配带端口的 URL（URLPattern 语义），已在 `capabilities/default.json` 增加 `http://*:*` / `https://*:*`。用户若使用特殊端口的 Base URL，需确认范围覆盖。
2. **Scope 拒绝错误曾被误分类为「Base URL 无法连接」**（已修复）：`classifyError` 现将 `not allowed on the configured scope` 归入 Runtime 错误并提示检查 capability 配置。
3. **窗口几何在屏幕锁定/睡眠状态下异常**：无人值守运行时 CGWindow 报告退化尺寸（约 144×140 @ 负坐标），解锁后正常使用不受影响；未在真机交互下复核窗口尺寸记忆。
4. **真实第三方 Provider 的差异行为未覆盖**：本次端到端使用本地 OpenAI-compatible 端点；OpenAI/Anthropic/Google 官方服务的鉴权、限流、错误体差异由 pi-ai 适配层与单元/集成测试（faux provider + 401/404/429/超时/超限分类）覆盖，但未逐一在真实云服务上复核。
5. **钥匙串首访授权**：应用首次写入钥匙串时 macOS 可能弹出授权确认（本次自动化运行未遇到，debug 二进制直接成功）。
6. **vitest 沙箱限制**：本机命令沙箱会拦截 vitest worker 的 loopback 连接，涉及本地网络的测试以拦截式 mock 表达（真实 loopback 已在 Node 脚本与本次应用内联调中验证）。
7. **Streaming**：MVP 按设计决策使用非流式 `complete()`；tauri fetch 通道的流式（SSE）在 mock 层已工作（pi-ai 以 stream:true 请求并被正确解析），后续可作为增强开启（PRD §50）。
