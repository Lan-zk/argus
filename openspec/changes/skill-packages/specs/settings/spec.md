# settings Specification（delta）

## MODIFIED Requirements

### Requirement: Prompt 编辑器

类别的 Prompt 编辑区 SHALL 为纯文本或多行编辑器，并提供可用上下文变量的辅助说明（document、blocks、category、output_schema）。每次保存 Prompt SHALL 追加一个不可变版本（含来源与时间），MUST NOT 覆盖或删除历史版本。类别编辑区 SHALL 提供版本历史列表（版本号、来源、时间）与「回退到此版本」操作；回退 SHALL 把所选旧版内容复制为最新版本，MUST NOT 修改历史版本本身。版本变更与回退 MUST NOT 影响已审轮次的快照（其冻结的提示词版本保持原样）。

#### Scenario: 显示上下文辅助信息

- **WHEN** 用户展开某类别的 Prompt 编辑区
- **THEN** 界面显示可用上下文变量提示，用户可直接编辑并保存 Prompt

#### Scenario: 保存产生新版本

- **WHEN** 用户修改某类别 Prompt 并保存
- **THEN** 版本历史新增一条记录，此前版本仍完整可查看

#### Scenario: 回退即复制为最新

- **WHEN** 用户在版本历史中回退到版本 2
- **THEN** 系统把版本 2 的内容复制为新的最新版本，版本 2 本身与其后版本不被删除

#### Scenario: 历史轮次不受回退影响

- **WHEN** 用户回退提示词后查看此前完成的审阅轮次
- **THEN** 该轮结果与当时冻结的提示词版本保持原样，不受回退影响
