# Tasks: model-config-ux

依赖顺序执行；规格引用写作 `spec:<capability>`。每个 Phase 结束应用保持可运行。

## 1. 领域与类型

- [x] 1.1 实现 `src/domain/presets.ts`：29 个预设的 `MODEL_PRESETS` 映射表（pi-ai Provider id、显示名、分组国内/国际/聚合、推荐默认模型、地域变体标注）；快照单测对照 pi-ai 静态目录（预设 id 可注册、推荐模型存在于目录、清单数量与分组正确）
- [x] 1.2 扩展 `src/domain/types.ts`：`ProviderKind` 放宽为 `FourFamily | PiProviderId` 联合；新增 `ModelPreset`、`DiscoveredModel` 类型；`vue-tsc` 全绿且旧 4 家族值兼容（现有测试不回归）

## 2. 模型发现（spec:ai-runtime 模型发现）

- [x] 2.1 实现 `resolveModel` 的 pi-ai 内置 Provider 注册表分发：命中预设 id → 惰性注册对应工厂并从其目录构建 Model（含 contextWindow 元数据）；单测覆盖 deepseek/minimax（anthropic 协议）/openrouter 三类路径与旧 4 家族回归
- [x] 2.2 实现 `catalogModels(presetId)`：读取 pi-ai 静态目录映射为 `DiscoveredModel[]`（离线、含推荐默认标记）；单测覆盖目录非空、元数据透传、未知 id 报错
- [x] 2.3 实现 `fetchRemoteModels({baseUrl, apiKey, family})`：`GET {baseUrl}/models` + Bearer 鉴权（Anthropic 家族补 `anthropic-version` 头），经 `globalThis.fetch`（Tauri WebView 内即 http 通道）；只取 `data[].id`；非 200/解析失败 → `classifyError` 归类；单测覆盖 401 映射、非标响应降级、Key 不出现在错误信息
- [x] 2.4 实现 `mergeModels(static, remote)`：按 id 去重、静态项优先保留元数据；单测覆盖重叠合并、互斥并集、空输入

## 3. 设置页交互（spec:settings 模型配置管理）

- [x] 3.1 SettingsPage 新增流程改两步状态机（pick → configure）：pick 步预设卡片网格（按分组）+「自定义连接」+「本地 OpenAI-compatible」入口；验证三入口可达且视觉与现有 design token 一致
- [x] 3.2 configure 步预设精简表单：唯一必填 API Key；模型下拉 = `mergeModels(静态目录, 检索结果)`，推荐默认预选中；高级项（temperature/maxTokens/contextWindow）折叠；验证未填 Key 也能看静态目录（离线场景）
- [x] 3.3 自动检索交互：Key 输入失焦且非空 → 300ms 防抖自动检索；「重新检索」按钮；检索中状态、失败行内弱提示（复用错误分类文案）；组件测试覆盖失焦触发、空值不触发、失败不阻断下拉与手动输入
- [x] 3.4 自定义连接路径：保留全字段表单（4 家族 + BaseURL + Key + 模型名），接入「检索模型」按钮与手动输入并存；验证自定义端点检索成功/失败两态
- [x] 3.5 同 Provider 复用 Key：configure 步检测该 Provider 已有配置的 keyringRef → 跳过 Key 输入直接检索，提供「更换 Key」折叠入口；单测覆盖复用命中/未命中/更换后旧配置不受影响
- [x] 3.6 预设保存链路：保存写钥匙串（条目仍为配置 id）+ 脱敏持久化 + 设为默认流程不变；验证保存后列表展示 Provider 显示名与模型名、重启恢复正常

## 4. 联调与交付

- [x] 4.1 端到端联调：用本地 mock `/models` 端点验证「选预设 → 贴 Key → 失焦自动检索 → 下拉合并去重 → 保存 → 测试连接 → 再加一个模型复用 Key」全流程；自定义连接走真实可用端点或 mock 双态验证；更新 docs/known-issues.md
- [x] 4.2 交付检查：vitest 全绿、`vue-tsc` 干净、`tauri build` 产出可运行 .app；README 模型配置指引更新为预设流程
