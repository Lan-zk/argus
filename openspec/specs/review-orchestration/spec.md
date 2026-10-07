# review-orchestration Specification

## Purpose
管理一次审阅的会话生命周期与各类别的并行调度：创建会话与任务、并发控制、失败隔离、单类重跑、长文降级与整体状态判定。

## Requirements

### Requirement: 审阅会话与状态机

用户发起审阅后系统 SHALL 在目标项目下创建一个轮次（Round），记录所属项目、轮次序号、文档、选中的类别集合（含各类别使用的提示词版本）、模型配置与创建时间。轮次状态 MUST 为以下之一：idle、running、completed、partial_failed、failed。

#### Scenario: 全部类别成功

- **WHEN** 所有选中的类别都执行成功
- **THEN** 轮次状态为 completed

#### Scenario: 部分类别失败

- **WHEN** 至少一个类别成功且至少一个类别失败
- **THEN** 轮次状态为 partial_failed，成功的类别结果仍可查看

### Requirement: 类别并行执行与并发控制

每个选中类别 SHALL 生成独立的运行任务（CategoryRun），状态机为 pending、running、completed、failed。系统尽量并行执行，并发上限默认为 3，且 Provider 的并发限制优先于应用并发上限。

#### Scenario: 多类别并行

- **WHEN** 用户选择 6 个类别开始审阅
- **THEN** 各 CategoryRun 独立执行，界面逐个显示每个类别的状态（如「完成 · 8」「分析中」「等待」「失败」）与 Finding 数量

### Requirement: 单项失败隔离

一个类别失败 MUST NOT 使整个审阅失败或中断其他类别。用户仍可查看已完成类别的 Findings，并可单独重新运行失败类别。

#### Scenario: 一个失败其余继续

- **WHEN** 结构类别执行失败而其他类别仍在运行
- **THEN** 其他类别继续执行并正常显示结果，结构类别显示失败与重跑入口

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

### Requirement: 完成即显示

一个类别完成后其 Findings SHALL 立即可见，MUST NOT 等待其他类别完成。汇总报告 MUST 等待审阅阶段全部结束（全部类别达到 completed 或 failed）后才生成。

#### Scenario: 先完成先显示

- **WHEN** 逻辑类别先于修辞类别完成
- **THEN** 逻辑类别的 Findings 立即出现在工作台，无需等待修辞类别

### Requirement: 长文本结构化降级

当全文超过模型上下文窗口时，系统 SHALL 先生成文档结构表示（标题层级、各段行号索引、各段首句或摘要），再基于结构表示整体审阅。降级 MUST 遵守：按段落边界组织、不从句子中间截断、保留行号与相邻上下文引用；降级是整体策略，MUST NOT 按块并行切分审阅；降级 MUST NOT 改变 Finding 定位算法。

#### Scenario: 超限触发降级

- **WHEN** 带行号全文超过当前模型配置的上下文容量
- **THEN** 系统先生成文档结构表示，再以结构表示为审阅输入执行各类别，定位算法与全文模式一致

#### Scenario: 段落边界不被截断

- **WHEN** 生成文档结构表示
- **THEN** 每个条目对应完整段落（首句或摘要），不存在从句子中间截断的条目
