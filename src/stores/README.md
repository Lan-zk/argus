# src/stores/ — Pinia 状态

全局状态按职责拆分为 5 个 store；持久化统一走 [`lib/persistence.ts`](../lib/README.md)（tauri-plugin-store），API Key 走 [`lib/keyring.ts`](../lib/README.md)（macOS 钥匙串）。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| `settings.ts` | 模型配置、类别与 Prompt、主题偏好、最近一次 Review 引用；`init()` 幂等加载 |
| `session.ts` | 当前审阅会话：原文、各类别状态、findings、报告；绑定领域日志、驱动 orchestrator、支持重启恢复与「清除并新建」 |
| `ui.ts` | 纯 UI 状态：当前页面（NewReview / Workspace / Settings）等 |
| `theme.ts` | 主题应用（spec: theme-system）：设计语言（swiss / apple）× 明暗组合 → `data-theme`；mount 前恢复，首帧即目标主题、无闪烁 |
| `onboarding.ts` | 首次运行引导状态（spec: onboarding-first-run）：完成标记持久化，重复启动不再弹出 |

`*.test.ts` 为对应单测（vitest）。
