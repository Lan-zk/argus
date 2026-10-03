# finding-pipeline Specification

## Purpose
定义 Finding 的后处理行为契约：模型输出的规范化校验、行号+内容+hash 三信号定位（含无法定位的处理）、同类去重与重叠支持。

## Requirements

### Requirement: Finding 规范化

系统收到模型输出后 SHALL 在应用侧完成规范化：验证必填字段（severity、title、quote、problem、reason、suggestion）、清理空字段、把非法 severity 修复为合法值（high/medium/low）。这些校验逻辑 MUST NOT 依赖 Prompt 完成。quote 为空的 Finding SHALL 被丢弃并记录日志。

#### Scenario: 非法 severity 被修复

- **WHEN** 模型返回 severity 为「critical」（非法值）
- **THEN** 系统将其修复为合法值（按规则映射），Finding 保留

#### Scenario: quote 为空被丢弃

- **WHEN** 模型返回的某条 Finding quote 为空字符串
- **THEN** 该 Finding 被丢弃并记录日志，其余 Finding 正常处理

### Requirement: 三信号定位

每条 Finding 携带 lineHint（模型行号提示）、quote（引用原文）、contentHash（归一化内容哈希）三个信号，任何单一信号都 MUST NOT 被独立信任。系统 MUST 在模型返回后自行执行三步定位：

1. 内容匹配：将 quote 归一化（至少忽略空白差异）后在全文范围内检索，收集全部候选位置；
2. 行号消歧：仅一处候选时直接采用；多处候选时取与 lineHint 最接近的一处；
3. hash 校验：对定位结果计算内容哈希并与返回的 contentHash 比对，不一致时以内容匹配结果为准并记录日志。

行号提示与命中行不符时 MUST 以内容匹配结果为准。定位成功后系统写入渲染所需的内部定位字段（blockId 与块内区间）。

#### Scenario: 唯一命中直接定位

- **WHEN** 某条 Finding 的 quote 归一化后在全文只命中一处
- **THEN** 系统直接采用该位置，写出块与区间定位字段

#### Scenario: 多处命中按行号消歧

- **WHEN** quote 在全文命中 3 处且 lineHint 为 19
- **THEN** 系统采用起始行号最接近 19 的候选，并记录消歧日志

#### Scenario: 行号提示错误以内容为准

- **WHEN** lineHint 为 5 而内容匹配唯一命中第 42 行
- **THEN** 定位结果为第 42 行，系统记录「行号提示与命中不符」日志

#### Scenario: hash 不一致以内容为准

- **WHEN** 定位结果计算出的内容哈希与模型返回的 contentHash 不一致
- **THEN** 仍采用内容匹配结果，记录 hash 不一致日志

### Requirement: 未定位 Finding（unanchored）

内容匹配无法命中的 Finding SHALL 被保留并标记为 unanchored：在右侧批注区正常显示（带未定位标注），MUST NOT 在左侧原文显示高亮，MUST NOT 参与点击定位。

#### Scenario: 引用不存在于原文

- **WHEN** 某条 Finding 的 quote 归一化后在全文无任何命中
- **THEN** 该 Finding 标记 unanchored，右侧显示并标注「未定位」，左侧无高亮

### Requirement: 同类去重

系统 SHALL 仅在同一 Category 内合并明显重复：quote 相同、Finding 类型相同、problem 高度相似的 Finding 合并为一条。不同 Category 的相似 Finding MUST NOT 合并。

#### Scenario: 同类明显重复被合并

- **WHEN** 逻辑类别返回两条 quote 相同、标题相同、problem 高度相似的 Finding
- **THEN** 两条合并为一条，计数不重复

#### Scenario: 跨类相似不合并

- **WHEN** 同一句话同时存在逻辑类与修辞类的 Finding
- **THEN** 两条 Finding 都保留并显示

### Requirement: 重叠 Finding 支持

同一原文位置 MUST 支持存在多个 Finding（包括跨类别与同类别），系统 MUST NOT 假设每个字符区间只属于一个 Finding。左侧高亮 SHALL 支持叠加显示。

#### Scenario: 同句多问题

- **WHEN** 同一句话同时被标记了逻辑问题与修辞问题
- **THEN** 该句高亮同时关联两条 Finding，界面以可区分的方式叠加呈现
