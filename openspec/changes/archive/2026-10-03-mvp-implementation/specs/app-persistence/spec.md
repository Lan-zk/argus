# app-persistence

## Purpose

定义应用状态的持久化与恢复行为：保存配置与最近一次审阅、重启后恢复、API Key 的安全存储、界面偏好记忆。

## ADDED Requirements

### Requirement: 应用状态保存范围

系统 SHALL 持久化保存：模型配置、Review Category（含 Prompt）、当前输入文本、最近一次 Review 结果。保存对用户透明，MUST NOT 要求用户手动保存。

#### Scenario: 重启后配置仍在

- **WHEN** 用户配置了模型与自定义类别后重启应用
- **THEN** 所有配置与类别（含 Prompt 修改）原样恢复

### Requirement: 恢复最近一次 Review

系统 SHALL 保留最近一次 Review 的完整结果（原文、选中类别、各运行状态、Findings、报告），应用重启后可恢复查看。恢复时 MUST 提供明确的恢复提示与「清除并新建」入口。

#### Scenario: 重启恢复审阅结果

- **WHEN** 用户完成一次审阅后关闭并重新打开应用
- **THEN** 工作台恢复该次审阅的原文、Findings 与报告，并显示恢复提示条

#### Scenario: 清除并新建

- **WHEN** 用户点击「清除并新建」
- **THEN** 最近一次 Review 数据被清除，应用回到 New Review 空白状态

### Requirement: API Key 安全存储

API Key 属于敏感信息：系统 MUST NOT 以明文形式长期存储在普通数据文件中，SHALL 使用系统安全存储能力保存；日志与错误信息 MUST NOT 包含完整 API Key。

#### Scenario: Key 不落明文文件

- **WHEN** 用户保存一条含 API Key 的模型配置
- **THEN** 应用数据文件中不出现该 Key 的明文，Key 通过系统安全存储能力读取

#### Scenario: 界面不回显完整 Key

- **WHEN** 用户重新打开一条已保存的模型配置编辑界面
- **THEN** API Key 字段以脱敏形式显示，不完整回显

### Requirement: 界面偏好记忆

系统 SHALL 保存并恢复用户的界面偏好，至少包括工作台左右分栏宽度。

#### Scenario: 分栏宽度恢复

- **WHEN** 用户调整分栏宽度后重启应用
- **THEN** 工作台恢复上次使用的分栏宽度
