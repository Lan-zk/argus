# finding-pipeline Specification（delta）

## MODIFIED Requirements

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
