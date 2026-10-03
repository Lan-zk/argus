# review-ui

## Purpose

定义三个页面（New Review、Review Workspace、Settings 入口）的界面行为契约：输入与前置校验、双栏只读工作台、重叠高亮与双向定位、筛选、运行状态与空态反馈。

## ADDED Requirements

### Requirement: 原文输入与长度上限

New Review 页面 SHALL 提供大型文本输入区，支持直接粘贴 Markdown 文本并保留其结构。系统 SHALL 显示字符计数，文稿上限为 30 000 字符，超限内容 MUST NOT 进入审阅。

#### Scenario: 粘贴超长文本

- **WHEN** 用户粘贴超过 30 000 字符的文本
- **THEN** 系统阻止超出部分进入输入区并显示上限提示

### Requirement: 类别选择

页面 SHALL 显示所有已启用类别的复选框，每类一条；初始勾选状态由该类别的「默认选中」设置决定。页面 SHALL 提供全选、清空、恢复默认操作。

#### Scenario: 默认选中生效

- **WHEN** 用户进入 New Review 且「演讲表达」类别为默认不选中
- **THEN** 该类别复选框初始为未勾选，其余默认选中的类别为勾选

### Requirement: 开始审阅前置校验

以下任一情况 MUST 阻止开始审阅并显示明确错误：原文为空、未选择任何类别、当前没有可用模型配置。错误提示 SHALL 逐项列出原因，MUST NOT 只显示「发生错误」。

#### Scenario: 无模型配置

- **WHEN** 用户未配置任何模型就点击「开始审阅」
- **THEN** 按钮不可用或点击后被阻止，错误区明确列出「没有可用模型配置，请到设置中添加」

### Requirement: 双栏布局与独立滚动

工作台 SHALL 采用双栏布局：左侧原文（默认约 60%）、右侧批注（默认约 40%）。用户可以拖动中间分隔线调整比例，当前宽度 SHALL 被保存。左右两栏 MUST 各自独立滚动，点击任一侧内容 MUST NOT 改变另一侧或页面本身的滚动位置。

#### Scenario: 拖动分栏并记忆

- **WHEN** 用户把分栏拖到 50/50 后离开再回到工作台
- **THEN** 分栏保持 50/50

### Requirement: 只读原文渲染

左侧 SHALL 显示完整原文且只读，基于块模型渲染 Markdown（保留段落结构、标题、列表、引用、代码），并显示行号。unanchored Finding 不在左侧产生高亮。

#### Scenario: 渲染保留结构

- **WHEN** 原文包含二级标题、引用与列表
- **THEN** 左侧以对应样式渲染各块，每块旁显示起始行号

### Requirement: 高亮与双向定位

点击左侧某高亮时系统 SHALL：找到对应 Finding、右侧批注面板内部滚动到该 Finding 并使其进入选中状态、左侧滚动位置保持不变；若该文本关联多个 Finding 则先显示 Finding 列表供选择。点击右侧 Finding 卡片时系统 SHALL：左侧原文面板内部滚动到对应原文并尽量居中、高亮对应文本、右侧滚动位置保持不变。鼠标悬停高亮或卡片时 SHALL 临时强调对应对象，移出后取消。

#### Scenario: 点击原文定位右侧

- **WHEN** 用户点击左侧一处高亮
- **THEN** 右侧滚动到对应卡片并选中；左侧与页面滚动位置不变

#### Scenario: 点击卡片定位左侧

- **WHEN** 用户点击右侧一张 Finding 卡片
- **THEN** 左侧滚动到对应原文并居中高亮；右侧与页面滚动位置不变

#### Scenario: 多 Finding 位置弹出列表

- **WHEN** 用户点击的高亮文本关联 2 条 Finding
- **THEN** 系统显示该位置的 Finding 列表，用户选择后再定位

#### Scenario: 悬停临时强调

- **WHEN** 鼠标移入一处高亮
- **THEN** 对应卡片呈现临时强调样式；移出后恢复

### Requirement: Category 与 Severity 双筛选

右侧 SHALL 支持 Category 筛选与 Severity 筛选（严重/建议修改/可优化），两个条件 MUST 可同时生效（交集）。

#### Scenario: 组合筛选

- **WHEN** 用户选择「逻辑 + 严重」
- **THEN** 右侧只显示逻辑类别的严重级 Finding

### Requirement: 运行状态展示

工作台顶部 SHALL 显示文档字数、已选类别数量、整体状态（running/completed/partial_failed 等）与操作（重新分析、查看报告、设置入口）。类别状态条 SHALL 逐类显示运行状态与 Finding 数量；失败类别 SHALL 提供单独重跑入口。

#### Scenario: 失败类别显示重跑

- **WHEN** 清晰度类别执行失败
- **THEN** 状态条该类显示「失败」与重跑按钮，点击后仅重跑该类

### Requirement: 加载与空状态反馈

AI 分析期间界面 SHALL 按类别显示独立进度文案（如「逻辑：正在分析全文逻辑……」），MUST NOT 只用一个无限旋转图标。某筛选或类别无 Findings 时 SHALL 显示「本次 Review 未发现该类别下的明显问题」，MUST NOT 显示「文章没有任何问题」类断言。

#### Scenario: 分析中分品类进度

- **WHEN** 6 个类别中有 2 个仍在运行
- **THEN** 界面对已完成的显示结果数量、对运行中的显示分析文案、对排队中的显示等待状态

#### Scenario: 空结果文案

- **WHEN** 修辞类别完成且返回 0 条 Finding
- **THEN** 右侧对该类别显示规定的空态文案

### Requirement: Finding 卡片内容

每张 Finding 卡片 SHALL 至少显示：Category、Severity、标题、对应原文引用、问题说明、原因、修改建议。卡片 SHALL 紧凑、Severity 与 Category 易于识别。Finding MUST NOT 有 Accept/Reject/Resolved 状态操作。

#### Scenario: 卡片字段完整

- **WHEN** 渲染一条严重级逻辑 Finding
- **THEN** 卡片显示「逻辑」「严重」标签、标题、原文引用、问题、原因与建议，无任何状态按钮
