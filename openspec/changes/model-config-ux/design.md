# Design: model-config-ux

## Context

MVP 交付后「设置 → Models」为四字段并列表单（Provider 家族下拉 + 手填模型名 + API Key + Base URL）。动机见 proposal.md。pi-ai（@earendil-works/pi-ai）内置 26 个纯 API Key Provider 的静态模型目录（`providers/*.models.js`，含 contextWindow/maxTokens 元数据）与对应 Provider 工厂（已处理各家协议差异，如 MiniMax 走 anthropic-messages、DeepSeek 走 openai-completions 且带专属 compat）；显式传入的 apiKey 优先于环境变量解析，与现有钥匙串短路径读取天然契合。业界共识（Cherry Studio / LobeChat / ChatBox / Open WebUI）：`GET {baseUrl}/models` + Bearer Key 为模型列表检索的标准约定。

## Goals / Non-Goals

**Goals:**

- 新增配置的主流路径收敛为「选预设 → 贴 Key → 选模型」三步，唯一必填为 API Key
- 模型发现三层（静态目录 / 实时检索 / 手动输入）合并去重，离线可用
- 自定义连接全字段表单保留，兼容任意 OpenAI-compatible 端点
- 已保存的旧配置（4 家族）零迁移可用

**Non-Goals:**

- 不做 Provider 级多模型多选（数据模型维持一条配置 = 一个模型，用户已确认）
- 不做 OAuth/订阅/云凭证类 Provider（Bedrock、Vertex、Azure、Copilot、Codex 等）
- 不做目录运营功能（定价页、模型能力对比、按热度排序等）

## Decisions

### 1. 预设清单硬编码为 pi-ai Provider id 映射表

`src/domain/presets.ts` 导出 `MODEL_PRESETS: ModelPreset[]`，每项含：pi-ai Provider id、显示名（中英）、分组（国内/国际/聚合）、推荐默认模型 id、可选地域变体。清单为静态代码（非运行时拉取），与 pi-ai 版本一起演进；新增 Provider = 改一张表。

29 项：deepseek、moonshotai(+cn)、zai(+coding-cn)、minimax(+cn)、qwen-token-plan(+cn/+individual)、xiaomi(+3 变体)、ant-ling、openai、anthropic、google、xai、mistral、groq、cerebras、together、fireworks、nvidia、huggingface、baseten、openrouter、vercel-ai-gateway。（opencode/opencode-go 无固定 baseUrl，剔除）

- 备选（运行时枚举 pi-ai 全部 Provider）：被否——含大量 OAuth/云凭证类，需逐个过滤反而更复杂。

### 2. `ProviderKind` 扩展为开放联合类型，resolveModel 按注册表分发

`ModelConfig.provider: ProviderKind` 从 4 个字面量扩展为 `FourFamily | PiProviderId`（string 联合）。`resolveModel` 维护 id → Provider 工厂 的惰性注册表：命中 pi-ai 内置 id → 注册对应工厂并从其目录取 Model（元数据完整，含 contextWindow）；否则走现有 4 家族分支。旧配置的 4 家族值不受影响。

### 3. 模型发现独立模块，两层结果统一为 `DiscoveredModel`

`src/ai/model-discovery.ts`：

```
catalogModels(presetId) → DiscoveredModel[]        // 读 pi-ai 静态目录（离线）
fetchRemoteModels({baseUrl, apiKey}) → DiscoveredModel[]  // GET {baseUrl}/models
mergeModels(static, remote) → DiscoveredModel[]    // 按 id 去重，静态项优先（保留元数据）
```

`DiscoveredModel = { id, name?, contextWindow?, recommended? }`。实时检索经 `globalThis.fetch`（Tauri WebView 内即 tauri http 通道，capability 已覆盖 https://** 与带端口 http），鉴权 `Authorization: Bearer <key>`；非 200/解析失败 → `classifyError` 归类上抛（401 → API Key 无效等，复用现有文案与脱敏）。Anthropic 端点的 /v1/models 需 `anthropic-version` 头——检索层按 Provider 家族补默认头。

### 4. SettingsPage 新增流程改为两步状态机

`addingStep: 'pick' | 'configure'`。pick 步渲染预设卡片网格（按分组）+「自定义连接」「本地 OpenAI-compatible」入口；configure 步按所选预设渲染精简表单（仅 API Key + 模型下拉 + 高级折叠项），自定义连接渲染现有全字段表单。API Key 输入 `@blur` 且非空 → 自动检索（防抖 300ms）；「重新检索」按钮恒在。下拉数据 = mergeModels(静态目录, 实时检索)；推荐默认模型预选中。

### 5. 同 Provider 复用 Key

settingsStore 新增 `hasKeyringKey(presetId)`（按 Provider id 查钥匙串，注意条目 user = 配置 id 而非 Provider id——实现为：查找该 Provider 的既有配置列表，存在则复用其配置 id 对应钥匙串条目，或直接复用既有配置的 keyringRef）。configure 步初始化时若存在可用 Key，跳过输入环节直接检索模型；仍允许用户更换 Key（「更换 Key」折叠入口）。

### 6. 测试连接不变

预设配置保存后「测试连接」沿用现有 `testConnection`（真实最小调用），与模型检索（/models 列表调用）互补：检索成功 ≠ 可对话，测试连接仍是权威验证。

## Risks / Trade-offs

- [静态目录与真实可用模型漂移] → 检索合并以服务端为准覆盖可用性，静态项仅补充元数据；手动输入兜底永不失效
- [/models 端点各家差异（字段缺失、分页、非标实现）] → 只取 `data[].id`，解析失败按可读错误降级，不阻断
- [预设清单随 pi-ai 升级漂移] → 清单与 pi-ai 同仓版本锁定，升级时跑一个快照测试对照
- [Key 失焦自动检索的误触发（粘贴半截 Key）] → 检索失败不弹强错误（行内弱提示），保存前测试连接兜底

## Migration Plan

绿地增量：`ProviderKind` 值域放宽为向后兼容变更，持久化文件无 schema 变化；旧 4 家族配置读写路径不变。无数据迁移。

## Open Questions

（无——三个关键决策已与用户确认：预设清单取 pi-ai 目录全部可用项、失焦自动检索 + 手动刷新、维持单模型配置。）
