# document-parsing

## Purpose

把用户粘贴的 Markdown 原文转换为带稳定 ID 与行号的块模型，作为工作台渲染与 Finding 定位的统一基准，保证 Markdown 渲染不破坏锚点。

## ADDED Requirements

### Requirement: 原文解析为块模型

系统 SHALL 把原文解析为有序的块（Block）序列。每个块 MUST 包含：稳定 ID（如 `block_001` 顺序编号）、类型、rawText（原始 Markdown 文本）、plainText（去除 Markdown 语法标记的纯文本）、order（序号）。

#### Scenario: 识别基本 Markdown 元素

- **WHEN** 用户粘贴包含标题、粗体、斜体、无序列表、有序列表、引用、链接的 Markdown 文本
- **THEN** 系统将原文解析为块序列，标题归入 heading、列表项归入 list_item、引用归入 quote，且解析不中断

#### Scenario: 代码块识别

- **WHEN** 原文包含围栏代码块（``` 包裹）
- **THEN** 该内容归入 code 块，代码内容原样保留在 rawText 与 plainText 中

#### Scenario: 不支持的语法不中断解析

- **WHEN** 原文包含解析器不认识的 Markdown 语法
- **THEN** 该内容归入 other 类型块，解析过程不失败、不丢弃文本

#### Scenario: 空行分组

- **WHEN** 原文中两个非空行之间存在一个或多个空行
- **THEN** 空行两侧的内容分属不同的块；连续的非空行归入同一块

### Requirement: 行号索引

每个块 MUST 记录其在原文中的起始行号，行号从 1 开始且与源文本行严格一致。工作台渲染原文时 SHALL 显示行号（L1…Ln），行号同时作为 Finding 定位信号之一。

#### Scenario: 行号与源文本一致

- **WHEN** 原文第 19 行起始的段落被解析为块
- **THEN** 该块的起始行号为 19，界面在该块旁显示 L19

### Requirement: 定位基准为块模型

系统 MUST 基于 Block 模型（rawText/plainText 与行号）完成 Finding 的内容匹配与高亮落点计算，SHALL NOT 先渲染 HTML 再用全文字符 offset 直接定位。高亮落点 MUST 来自定位算法的校验结果。

#### Scenario: 高亮落在正确的块内文本区间

- **WHEN** 一条 Finding 被定位到某块的 plainText 中的一段文本
- **THEN** 工作台在该块渲染后的对应文本区间上显示高亮，且不影响其他块的渲染
