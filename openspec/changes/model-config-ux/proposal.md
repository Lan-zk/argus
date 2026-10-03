# Change: model-config-ux

## Why

当前「设置 → Models」要求用户手填 Provider、模型名、Base URL 等全部字段，用户必须预先知道模型 ID 才能完成配置，摩擦高且易错。业界同类客户端（Cherry Studio / LobeChat / ChatBox / Open WebUI）的共识模式是「预设服务 → 只填 API Key → 自动检索模型列表 → 下拉选择」；且 pi-ai 已内置 26 个纯 API Key Provider 的静态模型目录（含 contextWindow/maxTokens 元数据与各家协议差异处理），具备超出业界通用做法的离线模型发现能力，未加以利用。

## What Changes

- 新增**预设服务选择**：新增模型配置时先从预设卡片（29 个 pi-ai 目录支持的 Provider：国内 15 / 国际 12 / 聚合 2）或「自定义连接」入口开始；预设内部预填 Provider id、Base URL、API 协议（含 MiniMax 走 Anthropic 协议这类差异）
- 新增**三层模型发现**：① pi-ai 静态目录（离线、带 ctx 元数据、含推荐默认模型）② `GET {baseUrl}/models` 实时检索（OpenAI 兼容约定，业界标准）③ 手动输入模型 ID 兜底；静态目录与实时检索结果合并去重展示
- 新增**自动检索交互**：API Key 输入框失焦且非空时自动触发模型检索，同时保留手动「重新检索」按钮；检索与测试连接复用现有错误分类（可读错误、Key 脱敏）
- 新增**同 Provider 复用 Key**：为同一预设服务添加第二个模型配置时自动复用钥匙串中已存的 API Key，无需重填
- **自定义连接保留**：现有全字段表单（Provider 家族 + Base URL + API Key + 模型名）作为兜底路径不变，兼容任意 OpenAI-compatible 端点
- `ModelConfig.provider` 类型从 4 个家族值扩展为接受 pi-ai 内置 Provider id（数据模型仍为一条配置 = 一个模型，不做 Provider 级多选）

## Capabilities

### New Capabilities

（无——模型发现的交互归入 settings，行为契约归入 ai-runtime，均为已有 capability 的增量）

### Modified Capabilities

- `settings`: 模型配置管理 requirement 增量——预设服务选择流程、唯一必填 API Key、模型下拉与自动检索交互、自定义连接并存、同 Provider 复用 Key
- `ai-runtime`: 新增模型发现 requirement——静态目录读取、`/models` 实时检索、结果合并去重、检索错误的分类与脱敏、不内置任何 Key

## Impact

- **代码**：`src/pages/SettingsPage.vue`（新增模型入口重做为两步流程）、新增 `src/ai/model-discovery.ts`（目录读取 + /models 检索 + 合并）、`src/ai/client.ts`（resolveModel 支持 pi-ai 内置 Provider id）、`src/domain/types.ts`（ProviderKind 扩展 + 预设元数据类型）、`src/stores/settings.ts`（同 Provider Key 复用）
- **依赖**：无新增 npm/crate 依赖（pi-ai 静态目录与 /models 检索均已有能力覆盖）
- **兼容性**：已保存的 4 家族 ModelConfig 原样可用；schema 无破坏性变更（provider 字段值域放宽）
- **范围边界**：不做 Provider 级多模型多选、不做 OAuth/订阅类 Provider（Bedrock/Vertex/Azure/Copilot/Codex）、不做模型定价/能力展示排序以外的目录运营功能
