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

每条 Finding 携带一个主锚（lineHint、quote、contentHash 三信号）与至多 2 个引用锚（各自独立携带同样三信号），任何单一信号都 MUST NOT 被独立信任。系统 MUST 在模型返回后对**每个锚独立**执行三步定位：

1. 内容匹配：将该锚的 quote 归一化（至少忽略空白差异）后在全文范围内检索，收集全部候选位置；
2. 行号消歧：仅一处候选时直接采用；多处候选时取与该锚 lineHint 最接近的一处；
3. hash 校验：对定位结果计算内容哈希并与返回的 contentHash 比对，不一致时以内容匹配结果为准并记录日志。

主锚携带行范围（span）时，系统 SHALL 以主锚代表句的内容命中结果与行范围互验：命中行 MUST 落在所报范围内，不一致时以内容命中为准对范围做收敛并记录日志；行号越界时 SHALL 收敛到文档实际行数；行范围超过文档总行数一半或超过 120 行时，SHALL 收敛为代表句所在块的范围并记录日志。

行号提示与命中行不符时 MUST 以内容匹配结果为准。定位成功后系统写入渲染所需的内部定位字段；主锚为行范围时写入覆盖该范围的块区间。

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

#### Scenario: 行范围与代表句互验失败收敛

- **WHEN** 主锚报 span 为 L10–L60，但代表句唯一命中第 80 行，且文档共 100 行
- **THEN** 系统以内容命中为准收敛行范围（围绕命中行所在块），记录互验失败日志

#### Scenario: 引用锚独立定位

- **WHEN** 一条 Finding 含主锚与 2 个引用锚，其中 1 个引用锚的 quote 在全文无命中
- **THEN** 主锚与另一引用锚正常定位；无命中的引用锚标记该引用未定位，Finding 本身的定位与保留不受影响

### Requirement: 未定位 Finding（unanchored）

**主锚**内容匹配无法命中的 Finding SHALL 被保留并标记为 unanchored：在右侧批注区正常显示（带未定位标注），MUST NOT 在左侧原文显示高亮，MUST NOT 参与点击定位。引用锚未命中 MUST NOT 使整条 Finding 变为 unanchored：主锚高亮保留，该引用在批注内以「引用未定位」呈现。

#### Scenario: 引用不存在于原文

- **WHEN** 某条 Finding 的主锚 quote 归一化后在全文无任何命中
- **THEN** 该 Finding 标记 unanchored，右侧显示并标注「未定位」，左侧无高亮

#### Scenario: 引用锚失败不连累主批注

- **WHEN** 某条 Finding 主锚命中，但其引用锚 quote 在全文无命中
- **THEN** 该 Finding 正常锚定与高亮，引用锚位置显示「引用未定位」标注，不产生左侧高亮

### Requirement: 同类去重

系统 SHALL 仅在同一 Category 内合并明显重复：**主锚 quote** 相同、Finding 类型相同、problem 高度相似的 Finding 合并为一条；引用锚不参与去重比较。不同 Category 的相似 Finding MUST NOT 合并。

#### Scenario: 同类明显重复被合并

- **WHEN** 逻辑类别返回两条主锚 quote 相同、标题相同、problem 高度相似的 Finding（引用锚不同）
- **THEN** 两条合并为一条，计数不重复

#### Scenario: 跨类相似不合并

- **WHEN** 同一句话同时存在逻辑类与修辞类的 Finding
- **THEN** 两条 Finding 都保留并显示

### Requirement: 重叠 Finding 支持

同一原文位置 MUST 支持存在多个 Finding（包括跨类别与同类别），系统 MUST NOT 假设每个字符区间只属于一个 Finding。左侧高亮 SHALL 支持叠加显示。

#### Scenario: 同句多问题

- **WHEN** 同一句话同时被标记了逻辑问题与修辞问题
- **THEN** 该句高亮同时关联两条 Finding，界面以可区分的方式叠加呈现
