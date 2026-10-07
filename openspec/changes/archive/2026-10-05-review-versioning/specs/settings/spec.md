# settings Specification（delta）

## MODIFIED Requirements

### Requirement: 模型配置管理

用户 SHALL 可以新增、编辑、删除模型配置，并设置一个默认模型。新增模型配置 SHALL 提供两条路径：

1. **预设服务**：用户从预设服务列表选择一个服务后，界面 SHALL 只要求填写 API Key 一项必填信息；Provider 标识、Base URL 与 API 协议由预设自动填充，无需用户输入。API Key 输入框失焦且内容非空时系统 SHALL 自动检索该服务可选模型列表，同时 SHALL 保留手动「重新检索」入口。用户从模型列表中选择一个模型后完成配置；每条配置仍对应一个模型。预设服务列表 SHALL 收录目录支持的全部「纯 API Key 鉴权 + 固定公网端点」服务（34 个，端点无论存储于 Provider 级或模型级均可被发现）；订阅绑定、云凭证或占位符端点的服务 MUST NOT 入选，且排除理由 SHALL 如实记录。
2. **自定义连接**：用户手动填写 Provider 家族、Base URL、API Key 与模型名，SHALL 兼容任意 OpenAI-compatible 端点；自定义连接 SHALL 提供模型实时检索与手动输入模型 ID 两种方式。

同一预设服务添加第二条模型配置时系统 SHALL 自动复用已保存的 API Key，不再要求重填。每条配置至少包含：provider、model、apiKey、可选 baseUrl、可选 temperature 与 maxTokens，以及**可选显示名称 displayName**；设置列表 SHALL 优先展示 displayName，未设置时回退到「服务名 · 模型 ID」。

默认模型的适用范围：默认模型 SHALL 决定全新审阅项目第一轮使用的模型配置；同一项目内后续轮次默认沿用上一轮快照的模型配置（见 review-versioning「新一轮配置沿用」），两规则 MUST NOT 被解释为冲突。

#### Scenario: 新增 OpenAI-compatible 配置

- **WHEN** 用户通过自定义连接填写 Base URL、API Key 与模型名并保存
- **THEN** 该配置出现在模型列表并可用于审阅

#### Scenario: DeepSeek 只填一个 Key 完成配置

- **WHEN** 用户在新增模型配置时选择预设「DeepSeek」，粘贴 API Key 后离开输入框
- **THEN** 系统自动检索并展示可选模型列表（含推荐默认模型），用户选择一个模型即可保存，全程未手动填写 Base URL 或模型 ID

#### Scenario: 端点存于模型级的预设同样可快速配置

- **WHEN** 用户选择预设「OpenCode Zen」（其端点仅存储于目录的模型条目而非 Provider 级）
- **THEN** 配置体验与其他预设一致：只填 API Key，模型列表来自静态目录与在线检索

#### Scenario: Key 失焦自动检索并可手动刷新

- **WHEN** API Key 输入框失焦且非空，或用户点击「重新检索」
- **THEN** 系统发起模型列表检索；检索期间显示进行中状态，失败时显示分类后的可读错误

#### Scenario: 自定义 OpenAI-compatible 连接

- **WHEN** 用户选择「自定义连接」，填写 Base URL 与 API Key 并触发检索
- **THEN** 系统从该端点检索模型列表供选择；用户也可以跳过检索直接手动输入模型 ID 保存

#### Scenario: 同 Provider 第二个模型复用 Key

- **WHEN** 用户已用 API Key 配置了一个 DeepSeek 模型，再次选择 DeepSeek 预设添加另一个模型
- **THEN** API Key 输入环节自动带入已存 Key（或跳过），直接进入模型选择

#### Scenario: 设置默认模型

- **WHEN** 用户把某条配置设为默认
- **THEN** 全新审阅项目的第一轮默认使用该模型配置；既有项目内开新一轮默认沿用上一轮快照的模型配置

#### Scenario: 显示名称快速区分

- **WHEN** 用户为一条模型配置填写了显示名称（如「公司网关 · flash」）
- **THEN** 设置列表该行优先显示此名称；未填写显示名称的配置显示「服务名 · 模型 ID」回退形态

#### Scenario: 编辑预设配置沿用预设形态

- **WHEN** 用户编辑一条由预设创建的模型配置
- **THEN** 编辑表单呈现预设形态（服务与端点内置、模型以下拉选择为主、API Key 留空即保持已存 Key），而非自定义连接的全字段表单；编辑自定义连接的配置仍呈现全字段表单

#### Scenario: 显示名称可选且不影响既有数据

- **WHEN** 用户打开一条未设置显示名称的旧配置编辑界面
- **THEN** 显示名称为空且可填写；保存后其他字段与调用行为不受影响
