# review-report

## Purpose

定义汇总报告的行为契约：自动生成时机、只基于已有 Findings 的输入约束、四部分内容结构与回跳交互。

## ADDED Requirements

### Requirement: 生成时机

系统 SHALL 在所有选中的类别达到终态（completed 或 failed）后自动生成汇总报告。存在失败类别时报告 MUST 仍可生成，且 MUST 明确列出失败的类别。

#### Scenario: 全部成功自动生成

- **WHEN** 最后一个类别完成
- **THEN** 系统自动生成报告，「查看报告」入口可用

#### Scenario: 部分失败仍生成并标注

- **WHEN** 6 个类别中 1 个失败、5 个完成
- **THEN** 报告生成，顶部明确标注失败类别，未将其统计计入正常摘要

### Requirement: 输入约束

报告 SHALL 且仅以以下内容为输入：文档概要、全部成功类别的 Findings、Category 统计、失败类别信息。报告 MUST NOT 重新独立审阅全文，MUST NOT 凭空创建已有 Findings 之外的具体问题；优先问题条目 MUST 关联已有 Finding 的引用，数量在 5 至 10 条之间。

#### Scenario: 优先问题可追溯

- **WHEN** 报告列出一条优先问题
- **THEN** 该条目引用一条已存在的 Finding，点击可回跳

### Requirement: 报告内容四部分

报告 SHALL 包含四部分：总体摘要（概括主要问题、不重复罗列所有 Finding）、优先问题（最多 5–10 条、每条关联已有 Finding）、Category Summary（每个类别的高/中/低计数与小结，失败类别单独呈现）、完整 Findings（全部结果入口）。

#### Scenario: 结构完整

- **WHEN** 报告生成完成
- **THEN** 四部分依次呈现，Category Summary 按类别列出严重/建议修改/可优化的计数

### Requirement: 报告内回跳

用户点击报告中的任意 Finding 或优先问题条目时，系统 SHALL 回到工作台对应的原文位置与右侧批注（复用双向定位行为）。

#### Scenario: 从报告回跳原文

- **WHEN** 用户在报告中点击一条优先问题
- **THEN** 视图切回工作台，左侧滚动到对应原文并高亮，右侧选中对应卡片
