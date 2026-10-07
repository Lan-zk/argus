# design/ — 设计文档

开发前的设计阶段产物：数据流梳理与交互原型，作为实现参照（token 与基础样式即迁移自这里的原型）。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| [`DESIGN-GUIDE.md`](./DESIGN-GUIDE.md) | 双主题设计指南：令牌契约、瑞士/Apple 语言规范、跨主题不变量、动效与禁令、新主题接入契约、评审门禁——评审、开发、设计共用的遵循文档 |
| `04-设置入侧栏原型.html` | **丢弃用原型**（prototype/UI 分支）：设置入口移入侧栏底部后的三变体确认——A 主区页面 / B 账户行菜单（Codex 式）/ C 滑出抽屉。**已裁决（2026-10-05）：B 账户行 + A 设置页**，落地见 `openspec/changes/settings-in-sidebar/`；本文件留作决策记录，不入构建 |
| `01-模块关系与数据流.html` | 模块关系与数据流图：domain / ai / orchestrator / stores / pages 的依赖与数据走向 |
| `02-产品交互原型.html` | 产品交互原型：三页布局与工作台双栏的原型实现，`src/styles/` 的 token 即由此迁移 |
| `03-迭代二交互原型.html` | 迭代二交互原型：顶层「审阅 / 设置」两入口的信息架构——审阅区下钻（项目列表 / 工作台轮次对比 / 新一轮导入与即时检查），设置区收纳类别版本历史与 Skill 包导入对话框（对应 change：review-versioning / document-import / skill-packages） |
| [`icons/`](./icons/README.md) | 应用图标设计源文件与生成说明 |

[`Apple-design-analysis.md`](./Apple-design-analysis.md) 是 Apple 风格设计语言分析（theme-system 中 apple 皮肤的取值依据）；根目录 [DESIGN.md](../DESIGN.md) 是设计系统的规范格式快照（配套 `.impeccable/design.json` 边车）。日常设计与评审遵循以 [`DESIGN-GUIDE.md`](./DESIGN-GUIDE.md) 为准。

这两个 HTML 是设计产物而非运行代码，浏览器直接打开即可查看，不参与构建。
