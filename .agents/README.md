# .agents/ — AI 代理工作流技能

供 AI 编码代理（ZCode / Claude Code 等）使用的项目级技能，围绕 [`openspec/`](../openspec/README.md) 的规格驱动工作流，每个技能是一个含 `SKILL.md` 的目录，代理按需自动加载。

## 技能清单

| 技能 | 触发场景 |
| --- | --- |
| `openspec-explore` | 检索理解现有规格与变更 |
| `openspec-propose` | 起草新的变更提案（proposal / specs 增量 / tasks） |
| `openspec-apply-change` | 按某个变更的 tasks 实施代码 |
| `openspec-update-change` | 更新进行中变更的 artifact |
| `openspec-sync-specs` | 把变更的 specs 增量同步到主规格 |
| `openspec-archive-change` | 归档已完成的变更到 `changes/archive/` |

人工协作时无需关心本目录；它是代理侧的操作手册。
