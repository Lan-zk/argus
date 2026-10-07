# ai-runtime Specification（delta）

## MODIFIED Requirements

### Requirement: 格式契约系统内置

数据格式契约（返回字段约束、severity 通用语义、引用与定位规则、归一化与 hash 算法）SHALL 完全由系统内置的 System Instruction 与 Output Schema 承载，MUST NOT 依赖类别 Prompt 携带。System Instruction SHALL 包含 severity 三级（high/medium/low）的通用语义定义；Output Schema SHALL 包含完整引用规则与归一化、hash 计算说明，引用规则 SHALL 覆盖：

- **主锚代表句**（quote/lineHint/contentHash）：逐字引用、长度指引、行号填写——规则与既有契约一致；
- **行范围**（可选 span：fromLine/toLine）：仅当问题为连续大段（段落级/节奏型）时提供，代表句 MUST 落在所报范围内；
- **引用锚**（可选 refs，最多 2 条）：仅当问题为关系型（如结论扩大、前后矛盾、呼应断裂、重复章节）时提供，每条引用 MUST 满足与主锚相同的逐字短引用规则。

模型未返回 span 与 refs 时，输出 SHALL 按既有主锚契约校验处理（与当前行为完全一致）。当类别 Prompt 不含任何数据格式约束时，系统组装的调用输入 SHALL 仍完整包含上述契约，且输出按既有 Schema 校验处理。

#### Scenario: 用户类别无格式约束仍合规

- **WHEN** 用户新建类别，其 Prompt 只描述审阅要求（不含 severity 定义、引用规则、hash 说明等任何格式内容）
- **THEN** 该类别的调用输入仍包含完整系统层格式契约（含行范围与引用锚规则），返回结果按 Structured Output 校验正常处理

#### Scenario: 系统层不被用户编辑影响

- **WHEN** 用户修改任一类别的 Prompt（包括内置类别的默认 Prompt）
- **THEN** System Instruction 与 Output Schema 的内容保持不变，其他类别的调用输入不受影响

#### Scenario: 不返回新字段的输出仍合规

- **WHEN** 模型返回的 Finding 只含 quote/lineHint/contentHash，不含 span 与 refs
- **THEN** 该输出按既有主锚契约校验通过，行为与引入本变更前完全一致

#### Scenario: 引用锚数量超限被截断

- **WHEN** 模型单条 Finding 返回 4 条 refs
- **THEN** 应用侧保留前 2 条参与处理，截断行为被记录日志，该 Finding 本身不受影响
