# ai-runtime Specification

## Purpose
定义模型调用的行为契约：Provider 与模型配置、每次审阅的 Prompt 组装、结构化输出的校验与修复、错误分类、重试策略与隐私边界。

## Requirements

### Requirement: Provider 支持

系统 SHALL 支持配置并调用以下四类 Provider：OpenAI、Anthropic、Google、OpenAI-compatible API。OpenAI-compatible MUST 支持用户自定义 Base URL、API Key 与 Model Name。系统 MUST NOT 内置任何固定 API Key。

#### Scenario: 通过自定义 Base URL 调用 OpenAI-compatible 服务

- **WHEN** 用户配置了一条 OpenAI-compatible 模型（含自定义 Base URL、API Key、Model Name）并以此运行审阅
- **THEN** 系统通过该 Base URL 完成调用并返回结构化结果

### Requirement: Prompt 四段组装

每次审阅调用的完整输入 SHALL 由四部分组成：System Instruction（公共规则）、Category Prompt（当前类别检查目标）、Output Schema（返回格式约束，至少包含 quote、lineHint、contentHash 字段及归一化与 hash 规则说明）、Document Context（带行号标注的全文）。每个类别使用完全独立的 Prompt，修改一个类别的 Prompt MUST NOT 影响其他类别。

#### Scenario: 组装包含四段

- **WHEN** 系统为某类别发起模型调用
- **THEN** 输入包含 System Instruction、该类别的 Category Prompt、Output Schema 与带行号的全文

#### Scenario: 修改 Prompt 不影响其他类别

- **WHEN** 用户修改了修辞类别的 Prompt 后重新运行该类别
- **THEN** 逻辑等其他类别的调用输入不发生任何变化

### Requirement: Structured Output 校验与自动修复

模型返回 MUST 为结构化数据（findings 数组，每项含 severity、title、quote、lineHint、contentHash、problem、reason、suggestion）。系统 MUST 验证返回 Schema；不合法时 SHALL 执行一次自动修复；修复仍失败则该类别标记为失败。

#### Scenario: 合法结构化输出通过

- **WHEN** 模型返回符合 Schema 的 findings JSON
- **THEN** 结果进入后续规范化与定位流程

#### Scenario: 非法输出自动修复一次

- **WHEN** 模型返回不符合 Schema 的内容（如字段缺失、JSON 格式错误）
- **THEN** 系统执行一次自动修复；修复成功则按合法结果处理

#### Scenario: 修复仍失败

- **WHEN** 自动修复后结果仍不符合 Schema
- **THEN** 该 CategoryRun 标记为 failed，其余类别不受影响

### Requirement: 错误分类与可读错误信息

系统 SHALL 区分以下错误类型：API Key 无效、模型不存在、Base URL 无法连接、Provider 请求超时、Rate Limit、Context Length 超限、Structured Output 无效、运行时错误、未知错误。错误信息 MUST 告诉用户下一步应检查什么，MUST NOT 只显示「发生错误」或裸 HTTP 状态码，MUST NOT 包含完整 API Key。

#### Scenario: Key 无效显示可读错误

- **WHEN** Provider 返回认证失败（如 401）
- **THEN** 界面显示「API Key 无效」类错误并指引到模型设置检查该 Key，错误信息不含完整 Key

### Requirement: 自动重试策略

网络类错误（超时、Rate Limit）SHALL 自动重试，最大自动重试次数为 2。API Key 错误、模型名称错误、Base URL 配置错误 MUST NOT 自动重试。用户可以随时手动重新运行失败类别。

#### Scenario: 超时自动重试后成功

- **WHEN** 某类别首次调用超时
- **THEN** 系统自动重试至多 2 次；期间用户可见「正在重试」状态；成功则正常完成

#### Scenario: 配置类错误不自动重试

- **WHEN** 某类别调用返回模型不存在（404）
- **THEN** 该类别立即标记失败并显示可读错误，不进行自动重试

### Requirement: Streaming 展示策略

当模型支持 Streaming 时系统可以使用流式接收，但 Finding 在结构完整并通过 Schema 校验前 MUST NOT 写入正式结果；流式期间界面只显示进行中状态。

#### Scenario: 流式期间不显示半成品

- **WHEN** 某类别正在流式接收模型输出
- **THEN** 界面显示该类别「正在分析……」，不展示任何未通过校验的 Finding

### Requirement: 隐私边界

系统 SHALL 只把必要内容（Prompt 与带行号全文）发送给用户配置的模型 Provider，MUST NOT 把原文发送给其他任何服务。系统日志默认 MUST NOT 保存完整原文与完整 API Key。

#### Scenario: 错误日志脱敏

- **WHEN** 一次模型调用失败并写入运行日志
- **THEN** 日志不含完整 API Key，也不含完整原文内容

### Requirement: 模型发现

系统 SHALL 提供三层模型发现能力并合并展示：

1. **静态目录**：对预设服务，系统 SHALL 能读取其内置静态模型目录（离线可用，含上下文窗口等元数据），并标注推荐默认模型；
2. **实时检索**：系统 SHALL 通过 OpenAI 兼容约定（`GET {baseUrl}/models`，携带用户 API Key 鉴权）从服务端检索模型列表，检索请求 MUST 经与模型调用相同的网络通道发出；
3. **手动输入**：用户 SHALL 始终可以手动输入任意模型 ID，不受目录与检索结果限制。

静态目录与实时检索结果 SHALL 按模型 ID 合并去重后展示。检索失败 MUST NOT 阻断静态目录与手动输入路径，且失败信息 SHALL 复用现有错误分类（可读错误、不含完整 API Key）。系统 MUST NOT 在模型发现过程中内置任何固定 API Key。

#### Scenario: 预设服务离线展示模型目录

- **WHEN** 用户选择一个预设服务尚未输入 API Key
- **THEN** 系统展示该服务的静态模型目录（含上下文窗口信息与推荐默认模型），不发起网络请求

#### Scenario: 实时检索合并去重

- **WHEN** 用户输入 API Key 后触发模型检索，服务端返回的列表与静态目录部分重叠
- **THEN** 界面展示合并去重后的模型列表，重叠模型不重复出现

#### Scenario: 检索失败可降级

- **WHEN** 模型检索请求失败（如 Key 无效或端点不支持 /models）
- **THEN** 界面显示分类后的可读错误，静态目录与手动输入仍可用，用户仍可完成配置

### Requirement: 格式契约系统内置

数据格式契约（返回字段约束、severity 通用语义、引用与定位规则、归一化与 hash 算法）SHALL 完全由系统内置的 System Instruction 与 Output Schema 承载，MUST NOT 依赖类别 Prompt 携带。System Instruction SHALL 包含 severity 三级（high/medium/low）的通用语义定义；Output Schema SHALL 包含完整引用规则（逐字引用、长度指引、行号填写、段落级问题的引用方式）与归一化、hash 计算说明。当类别 Prompt 不含任何数据格式约束时，系统组装的调用输入 SHALL 仍完整包含上述契约，且输出按既有 Schema 校验处理。

#### Scenario: 用户类别无格式约束仍合规

- **WHEN** 用户新建类别，其 Prompt 只描述审阅要求（不含 severity 定义、引用规则、hash 说明等任何格式内容）
- **THEN** 该类别的调用输入仍包含完整系统层格式契约，返回结果按 Structured Output 校验正常处理

#### Scenario: 系统层不被用户编辑影响

- **WHEN** 用户修改任一类别的 Prompt（包括内置类别的默认 Prompt）
- **THEN** System Instruction 与 Output Schema 的内容保持不变，其他类别的调用输入不受影响
