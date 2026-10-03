# Change: model-config-fixes

## Why

对 model-config-ux 预设清单的复核发现 5 处误判（opencode/opencode-go/kimi-coding/meta/radius 均为「纯 API Key + 固定端点」，却因调查方法缺陷被排除：只查了 provider 级 baseUrl 漏掉 model 级存储、把「带 OAuth 选项」误当「不能只填 Key」）；同时用户反馈自定义/同服务多配置缺一个快速区分手段，需要自定义显示名称。

## What Changes

- **补回 5 个预设**：OpenCode Zen（opencode，79 模型）、OpenCode Go（opencode-go，29）、Kimi Coding（kimi-coding，4，国内组）、Meta Model API（meta，5，国际组）、Radius（radius，28，聚合组）——预设总数 29 → 34
- **端点读取修正**：预设的实时检索输入改为「model 级 baseUrl 优先、provider 级兜底」（opencode 系列端点仅存于模型条目）
- **混合协议目录的手动输入 fallback 微调**：目录外模型 id 的 api 家族猜测，对端点固定的混合目录按目录主流家族推断，失败时保持现有可读错误兜底
- **github-copilot 排除理由勘误**：排除维持，但理由由「无法只填 Key」更正为「订阅绑定 + token 交换动态鉴权 + 模型清单随订阅变化」；同步修正 docs/known-issues.md 第 8 条的错误记录
- **displayName 字段**：ModelConfig 增可选自定义显示名称；设置列表行优先展示，输入入口位于自定义连接表单、编辑表单与预设「高级」折叠；随现有持久化链路保存（非敏感字段），调用/审阅逻辑零影响

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `settings`: 模型配置管理 requirement 增量——预设清单覆盖全部「纯 API Key + 固定端点」的 pi-ai 目录 Provider（34 个）；模型配置支持可选显示名称并优先展示

## Impact

- **代码**：`src/domain/presets.ts`（+5 预设与快照测试）、`src/ai/model-discovery.ts`（presetFetchInput 端点读取）、`src/ai/client.ts`（手动输入 fallback 家族推断）、`src/domain/types.ts` + `src/lib/persistence.ts`（displayName 字段透传）、`src/pages/SettingsPage.vue`（列表展示 + 三处输入框）
- **依赖**：无新增
- **兼容性**：已存配置不受影响（displayName 可选缺省）；旧持久化数据原样读取
- **范围边界**：github-copilot 等订阅/云凭证类维持排除；不做 Provider 级多模型选择
