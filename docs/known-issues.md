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

## model-config-ux 联调补充（2026-10-03）

8. **预设清单两次勘误**（model-config-fixes）：model-config-ux 立项写「26 个」，实施核对为 29 个；随后复核发现该轮调查存在两个方法缺陷——只查了 provider 级 baseUrl（opencode/opencode-go 的端点存于模型条目 `https://opencode.ai/zen`、`/zen/go`），并把「带 OAuth 可选项」误当「不能只填 Key」（kimi-coding/meta/radius 均支持纯 API Key + 固定端点）。5 个误判项已在 model-config-fixes 补回，现共 **34 个**（国内 16 / 国际 13 / 聚合 5）。教训：端点核查须同时看 provider 级与 model 级；auth 含 OAuth 可选项时须确认纯 Key 通道是否可用再下结论。
9. **预设静态目录会随 pi-ai 升级漂移**：快照测试（presets.test.ts）在升级 pi-ai 后需更新推荐模型；检索合并以服务端为准覆盖可用性。**github-copilot 维持排除**，理由更正为：订阅绑定 + token 交换动态鉴权（COPILOT_GITHUB_TOKEN 需换取会话 token 并注入动态 header）+ 模型清单随订阅变化（此前「无法只填 Key」的表述不准确）。
10. **/models 检索的端点差异**：部分服务的 baseUrl 不以 /v1 结尾（如 Fireworks /inference），直接追加 /models 可能 404 → 按「检索失败可降级」处理（静态目录 + 手动输入兜底），不阻断配置。
11. **Google 家族不支持 OpenAI 兼容 /models**：在线检索对 Google 预设返回可读降级提示，模型选择依赖静态目录（22 个）与手动输入。
12. **自定义家族不跨端点复用 Key**：openai-compatible 不同 BaseURL 视为不同服务，Key 复用仅限预设 Provider（服务身份唯一），防止 Key 泄给无关端点（有单测锁定）。
13. **应用内联调通过**（model_config 阶段）：预设目录离线可用、真实 tauri fetch 通道 /models 检索、合并去重、测试连接、同 Provider Key 复用（第二条配置获得独立钥匙串条目副本）全部通过。

## model-config-fixes 补充（2026-10-03）

14. **OpenCode Zen/Go 与 Radius 的 /models 在线检索支持情况未验证**：静态目录（79/29/28 个模型）与手动输入兜底可用；检索失败按既有降级路径弱提示。
15. **kimi-coding 与 moonshotai 同厂易混**：前者是 Coding 订阅端点（api.kimi.com/coding），Key 与开放平台不通用；配置错误时由测试连接给出可读错误。
16. **Radius 的 api 家族为 pi-messages（pi 自有协议）**：在线检索鉴权头按默认 Bearer 处理，如端点不支持则降级。

17. **「未知错误」诊断增强**（2026-10-03，用户反馈 opencode-go 审阅报未知错误）：复现核查表明预设解析/tauri 通道/分类链路对 opencode-go 均正常（假 Key 干净映射 401→API Key 无效）；真实 Key 下的 400 request_error / 5xx 原先落入 unknown 且不带原因。现已：unknown 文案内嵌脱敏原始原因片段、5xx→Provider 服务端错误、400 非超限→请求被拒绝（含原因），流水日志保留完整未分类原文。用户个案待新报错文案定位。

18. **OpenCode 系 400 MissingSessionID 根因与修复**（2026-10-03）：用户真实 Key 复现出 `400 {"type":"MissingSessionID"}` —— pi-ai 的 withOpenCodeSessionHeader 仅在 options.sessionId 存在时注入 `x-opencode-session` 路由头，此前三处调用点均未传。假 Key 时 401 先挡住故未暴露。已在 callFindings / testConnection / 报告调用统一传 `sessionId: argus-${配置id}`（稳定值，兼作其余 Provider 的缓存亲和键），含回归测试。

19. **Prompt 分层与文案净化**（prompt-layering，2026-10-03）：数据格式契约（severity 通用语义→System Instruction；引用规则/长度指引/段落级引用→Output Schema）全部上移系统层，7 个内置类别 Prompt 瘦身为纯审阅要求+一行校准。与 PRD §13 字面的偏差（severity 通用定义上移，类别层保留校准）视为对其意图的忠实执行。存量已保存类别的旧 Prompt 中重复规则无害，可「恢复内置」取精简版。渲染文案 5 处开发侧信息（MVP/PRD §n）已清除，测试固化「模板区无 MVP/PRD/§」断言。
