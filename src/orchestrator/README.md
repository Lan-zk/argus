# src/orchestrator/ — 审阅编排

把「领域核心 + AI 调用」串成一次完整审阅会话：并发调度多类别、维护状态机、单类重跑、汇总报告。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| `pool.ts` | 并发池：多类别并行调用，默认并发 3；单类失败不拖垮整场 |
| `orchestrator.ts` | 会话状态机：pending → running → completed / partial-failed；接收各类别 findings（含 anchored / unanchored）并驱动 UI 状态 |
| `report.ts` | 报告生成：优先问题清单（可追溯到具体 Finding）+ 各类别小结；全部类别完成或单类重跑后自动重新生成 |

`*.test.ts` 为对应单测（vitest）。会话的持久化与重启恢复由 [`stores/session.ts`](../stores/README.md) 与 [`lib/persistence.ts`](../lib/README.md) 承担。
