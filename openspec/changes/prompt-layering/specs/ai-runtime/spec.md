# ai-runtime

## Purpose

定义模型调用层的行为契约。本变更增量：数据格式契约全部系统内置。

## ADDED Requirements

### Requirement: 格式契约系统内置

数据格式契约（返回字段约束、severity 通用语义、引用与定位规则、归一化与 hash 算法）SHALL 完全由系统内置的 System Instruction 与 Output Schema 承载，MUST NOT 依赖类别 Prompt 携带。System Instruction SHALL 包含 severity 三级（high/medium/low）的通用语义定义；Output Schema SHALL 包含完整引用规则（逐字引用、长度指引、行号填写、段落级问题的引用方式）与归一化、hash 计算说明。当类别 Prompt 不含任何数据格式约束时，系统组装的调用输入 SHALL 仍完整包含上述契约，且输出按既有 Schema 校验处理。

#### Scenario: 用户类别无格式约束仍合规

- **WHEN** 用户新建类别，其 Prompt 只描述审阅要求（不含 severity 定义、引用规则、hash 说明等任何格式内容）
- **THEN** 该类别的调用输入仍包含完整系统层格式契约，返回结果按 Structured Output 校验正常处理

#### Scenario: 系统层不被用户编辑影响

- **WHEN** 用户修改任一类别的 Prompt（包括内置类别的默认 Prompt）
- **THEN** System Instruction 与 Output Schema 的内容保持不变，其他类别的调用输入不受影响
