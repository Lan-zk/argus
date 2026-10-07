# review-ui Specification（delta）

## MODIFIED Requirements

### Requirement: 原文输入与长度上限

New Review 页面 SHALL 提供大型文本输入区，支持直接粘贴 Markdown 文本并保留其结构。系统 SHALL 显示字符计数。**粘贴与手动输入路径**的文稿上限为 30 000 字符，超限内容 MUST NOT 进入审阅。文件导入路径的超限行为由 document-import「导入长文策略」规定（超过 30 000 字符时警告并允许继续，MUST NOT 静默截断），本条上限 MUST NOT 被解释为对导入路径的阻止。

#### Scenario: 粘贴超长文本

- **WHEN** 用户粘贴超过 30 000 字符的文本
- **THEN** 系统阻止超出部分进入输入区并显示上限提示

#### Scenario: 导入超长文档不受此限

- **WHEN** 用户经导入预览确认一份 80 000 字符的文档
- **THEN** 该文档完整进入审阅输入流程（警告与继续确认见 document-import「导入长文策略」），不受粘贴路径 30 000 字符上限的阻止
