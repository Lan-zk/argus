# openspec/ — 规格与变更（spec-driven）

OpenSpec 规格驱动开发的目录：当前生效的主规格、进行中的变更提案、已归档的变更。工作流技能见 [`../.agents/skills/`](../.agents/README.md)。

## 目录结构

| 路径 | 职责 |
| --- | --- |
| `config.yaml` | OpenSpec 项目配置：artifact 语言为中文，保留英文结构标题与 SHALL/MUST 关键字 |
| `specs/` | **主规格**（当前事实源）：`ai-runtime`、`app-persistence`、`document-parsing`、`finding-pipeline`、`review-orchestration`、`review-report`、`review-ui`、`settings` |
| `changes/` | **进行中的变更提案**（proposal / specs 增量 / tasks）：当前有 `theme-system`、`category-colors`、`onboarding-first-run` |
| `changes/archive/` | 已完成并归档的变更（含各历史版本的 specs 快照）：`mvp-implementation`、`model-config-ux`、`model-config-fixes`、`prompt-layering` |

## 工作流

提出变更 → 写 proposal（`changes/<name>/`）→ 按 tasks 实施 → 验证后 archive：把 specs 增量合入 `specs/` 主规格、变更移入 `changes/archive/<日期>-<name>/`。主规格与实现不一致时，以 OpenSpec 流程修订规格而非绕开。
