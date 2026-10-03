# settings

## Purpose

定义设置页的行为契约。本变更增量：内置类别默认 Prompt 仅含审阅要求。

## MODIFIED Requirements

### Requirement: Review Category 管理

用户 SHALL 可以：新建类别、修改名称与说明、修改 Prompt、启用、禁用、设置默认选中、删除、复制、调整显示顺序。禁用的类别 MUST NOT 出现在 New Review 的可选列表；删除类别 MUST NOT 影响其他类别。系统 SHALL 内置 6 个默认启用类别（逻辑、论点、论证、修辞、结构、清晰度）与 1 个默认禁用类别（演讲表达），各自带默认 Prompt；内置默认 Prompt SHALL 仅包含审阅要求与该类别可选的 severity 校准说明，MUST NOT 包含数据格式约束（返回字段、引用规则、hash 算法等由系统层内置）。「恢复内置类别」SHALL 提供当前精简版默认 Prompt。

#### Scenario: 复制类别

- **WHEN** 用户复制「逻辑」类别
- **THEN** 生成一个 Prompt 相同、名称标为副本的新类别，原类别不变

#### Scenario: 禁用后不出现在选择列表

- **WHEN** 用户禁用「修辞」类别并回到 New Review
- **THEN** 类别列表不显示修辞

#### Scenario: 默认 Prompt 不含格式约束

- **WHEN** 查看任一内置类别的默认 Prompt
- **THEN** 其中不含 severity 通用定义、引用规则、归一化或 hash 说明等数据格式内容，仅含审阅要求与类别校准
