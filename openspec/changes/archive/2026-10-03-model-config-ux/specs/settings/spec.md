# settings

## Purpose

定义设置页的行为契约：模型配置的增删改与测试连接、Review Category 的完整管理与 Prompt 编辑器。本变更增量：模型配置的预设服务快速配置流程与自定义连接并存。

## MODIFIED Requirements

### Requirement: 模型配置管理

用户 SHALL 可以新增、编辑、删除模型配置，并设置一个默认模型。新增模型配置 SHALL 提供两条路径：

1. **预设服务**：用户从预设服务列表选择一个服务后，界面 SHALL 只要求填写 API Key 一项必填信息；Provider 标识、Base URL 与 API 协议由预设自动填充，无需用户输入。API Key 输入框失焦且内容非空时系统 SHALL 自动检索该服务可选模型列表，同时 SHALL 保留手动「重新检索」入口。用户从模型列表中选择一个模型后完成配置；每条配置仍对应一个模型。
2. **自定义连接**：用户手动填写 Provider 家族、Base URL、API Key 与模型名，SHALL 兼容任意 OpenAI-compatible 端点；自定义连接 SHALL 提供模型实时检索与手动输入模型 ID 两种方式。

预设服务列表 SHALL 仅收录纯 API Key 鉴权、公网固定端点的服务；同一预设服务添加第二条模型配置时系统 SHALL 自动复用已保存的 API Key，不再要求重填。每条配置至少包含：provider、model、apiKey、可选 baseUrl、可选 temperature 与 maxTokens。

#### Scenario: 新增 OpenAI-compatible 配置

- **WHEN** 用户通过自定义连接填写 Base URL、API Key 与模型名并保存
- **THEN** 该配置出现在模型列表并可用于审阅

#### Scenario: DeepSeek 只填一个 Key 完成配置

- **WHEN** 用户在新增模型配置时选择预设「DeepSeek」，粘贴 API Key 后离开输入框
- **THEN** 系统自动检索并展示可选模型列表（含推荐默认模型），用户选择一个模型即可保存，全程未手动填写 Base URL 或模型 ID

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
- **THEN** 新的审阅默认使用该模型配置
