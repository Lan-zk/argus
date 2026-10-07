# review-orchestration Specification（delta）

## MODIFIED Requirements

### Requirement: 审阅会话与状态机

用户发起审阅后系统 SHALL 在目标项目下创建一个轮次（Round），记录所属项目、轮次序号、文档、选中的类别集合（含各类别使用的提示词版本）、模型配置与创建时间。轮次状态 MUST 为以下之一：idle、running、completed、partial_failed、failed。

#### Scenario: 全部类别成功

- **WHEN** 所有选中的类别都执行成功
- **THEN** 轮次状态为 completed

#### Scenario: 部分类别失败

- **WHEN** 至少一个类别成功且至少一个类别失败
- **THEN** 轮次状态为 partial_failed，成功的类别结果仍可查看

### Requirement: 单类重新运行

用户重新运行一个类别时系统 SHALL：删除该类别在本轮次中的旧 Findings、使用本轮次冻结的提示词版本与模型配置重新执行、保存新 Findings；其他类别不受影响。若所有类别此前已完成，重跑结束后 MUST 重新生成汇总报告。重跑 MUST NOT 使用该类别当前的最新提示词版本；用户显式升级本轮配置的操作 SHALL 触发对比「仅供参考」标注。

#### Scenario: 重跑只影响该类别

- **WHEN** 用户单独重跑某类别
- **THEN** 该类别旧 Findings 被替换，其他类别的 Findings 与运行状态保持不变

#### Scenario: 重跑沿用轮次冻结版本

- **WHEN** 用户修改某类别 Prompt 后在该轮内单独重跑该类别
- **THEN** 重跑使用该轮创建时冻结的提示词版本，而非修改后的最新版本

#### Scenario: 全部完成后重跑触发报告更新

- **WHEN** 轮次已完成（含 partial_failed）后用户重跑一个失败类别并成功
- **THEN** 汇总报告基于新的 Findings 集合重新生成
