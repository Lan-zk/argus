# settings Specification

## Purpose
定义设置页的行为契约：模型配置的增删改与测试连接、Review Category 的完整管理与 Prompt 编辑器。

## Requirements

### Requirement: 模型配置管理

用户 SHALL 可以新增、编辑、删除模型配置，并设置一个默认模型。每条配置至少包含：provider（OpenAI/Anthropic/Google/OpenAI-compatible）、model、apiKey、可选 baseUrl、可选 temperature 与 maxTokens。

#### Scenario: 新增 OpenAI-compatible 配置

- **WHEN** 用户填写 provider 为 OpenAI-compatible、自定义 Base URL、API Key 与模型名并保存
- **THEN** 该配置出现在模型列表并可用于审阅

#### Scenario: 设置默认模型

- **WHEN** 用户把某条配置设为默认
- **THEN** 新的审阅默认使用该模型配置

### Requirement: 测试连接

用户 SHALL 可以对任意模型配置执行测试连接。成功后 SHALL 显示明确成功结果；失败后 SHALL 显示 Provider 返回的可读错误（说明原因与下一步检查项），MUST NOT 只显示 HTTP 状态码。

#### Scenario: 测试成功

- **WHEN** 用户对配置正确的模型点击「测试连接」
- **THEN** 界面显示连接成功及所用模型信息

#### Scenario: 测试失败显示可读错误

- **WHEN** Base URL 无法连接
- **THEN** 界面显示「Base URL 无法连接」及建议检查网络或地址的提示，而非裸状态码

### Requirement: Review Category 管理

用户 SHALL 可以：新建类别、修改名称与说明、修改 Prompt、启用、禁用、设置默认选中、删除、复制、调整显示顺序。禁用的类别 MUST NOT 出现在 New Review 的可选列表；删除类别 MUST NOT 影响其他类别。系统 SHALL 内置 6 个默认启用类别（逻辑、论点、论证、修辞、结构、清晰度）与 1 个默认禁用类别（演讲表达），各自带默认 Prompt。

#### Scenario: 复制类别

- **WHEN** 用户复制「逻辑」类别
- **THEN** 生成一个 Prompt 相同、名称标为副本的新类别，原类别不变

#### Scenario: 禁用后不出现在选择列表

- **WHEN** 用户禁用「修辞」类别并回到 New Review
- **THEN** 类别列表不显示修辞

### Requirement: Prompt 编辑器

类别的 Prompt 编辑区 SHALL 为纯文本或多行编辑器，并提供可用上下文变量的辅助说明（document、blocks、category、output_schema）。MVP 不要求复杂 Prompt IDE。

#### Scenario: 显示上下文辅助信息

- **WHEN** 用户展开某类别的 Prompt 编辑区
- **THEN** 界面显示可用上下文变量提示，用户可直接编辑并保存 Prompt
