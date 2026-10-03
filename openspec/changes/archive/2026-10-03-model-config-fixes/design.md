# Design: model-config-fixes

## Context

model-config-ux 交付后复核发现预设清单存在 5 处误判（调查方法缺陷：只查 provider 级 baseUrl、把 OAuth 可选项误当排除条件），同时用户要求为模型配置增加自定义显示名称。动机见 proposal.md。关键事实（实测）：opencode/opencode-go/kimi-coding/meta/radius 均为纯 `envApiKeyAuth` + 固定端点；opencode 系列端点仅存于模型条目（`https://opencode.ai/zen`、`/zen/go`）；opencode 目录为混合协议（同一 Provider 下 anthropic-messages / openai-completions / openai-responses / google-generative-ai 并存）。

## Goals / Non-Goals

**Goals:**

- 预设清单与「纯 API Key + 固定端点」标准完全对齐（34 个），排除理由如实
- 端点读取对 provider 级 / model 级存储透明
- displayName 纯展示层增量，零调用逻辑影响

**Non-Goals:**

- 不引入 github-copilot（订阅绑定 + token 交换动态鉴权 + 清单随订阅变化）
- 不做 Cloudflare/Azure/Bedrock/Vertex 类需要额外用户输入（账号 ID、部署 URL、云凭证）的服务

## Decisions

### 1. 预设端点读取：model 级优先，provider 级兜底

`presetFetchInput` 与任何需要预设端点的逻辑统一走 `presetEndpoint(providerId)`：取 `getModels()[0]?.baseUrl ?? provider.baseUrl`。快照测试新增断言：每个预设都能解析出非空端点（两级任一）。

### 2. 混合协议目录的手动输入 fallback：按目录主流家族推断

目录外模型 id 手工构建时，api 家族取该目录中出现次数最多的家族（而非首项）；计数并列时取首项。opencode 目录主流为 anthropic-messages（claude 系条目最多），与手动输入常见目标一致。调用失败仍由现有可读错误兜底。

### 3. 新预设条目与分组

- `opencode`（OpenCode Zen，79 模型，推荐 `claude-fable-5`）、`opencode-go`（OpenCode Go，29，推荐取目录主流）、`radius`（Radius，28，聚合组）
- `kimi-coding`（Kimi Coding，国内组，端点 api.kimi.com/coding）
- `meta`（Meta Model API，国际组）
- 推荐模型以「存在于目录」为准，由快照测试锁定；分组：国内 +1、国际 +1、聚合 +3 → 16/13/5 = 34

### 4. displayName 字段形态

`ModelConfig.displayName?: string`。展示优先级：`displayName || 服务名(·地区) · model`；编辑/自定义/预设高级三处提供输入框（placeholder 显示回退值）；`sanitizeModelConfig` 原样透传（非敏感）。工作台与运行条不使用 displayName（保持 MVP 行为，避免扩散）。

### 5. 排除理由勘误

`docs/known-issues.md` 第 8 条改写：补回 5 个误判项；github-copilot 排除理由更正为「订阅绑定 + token 交换动态鉴权」；同时记录两条调查方法教训（model 级端点、OAuth 可选项 ≠ 排除条件），供后续清单演进引用。

## Risks / Trade-offs

- [Zen/Go 的 /models 在线检索支持情况未知] → 现有降级路径（静态目录 + 手动输入）覆盖，失败仅弱提示
- [kimi-coding 与 moonshotai 同厂易混] → 预设卡片区分标注「Coding 订阅端点」；Key 不互通时由测试连接给出可读错误
- [displayName 为空串与未设置等价] → 保存时 trim，空串存为未设置

## Migration Plan

绿地增量：displayName 可选字段向后兼容，旧持久化数据原样读取；预设快照测试随清单更新。

## Open Questions

（无——五项补回与 displayName 均经用户确认。）
