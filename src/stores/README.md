# src/stores/ — Pinia 状态

全局状态按职责拆分为 5 个 store；持久化统一走 [`lib/persistence.ts`](../lib/README.md)（底层 SQLite repo，spec: app-persistence），API Key 走 [`lib/keyring.ts`](../lib/README.md)（macOS 钥匙串）。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| `settings.ts` | 模型配置、类别与 Prompt、类别分组（spec: settings 类别分组管理：`allGroups` getter 通用虚拟置顶；组 CRUD actions 直写 repo——通用不可删不可改名；`assignCategoryGroup` 归属调整不动 Prompt 版本历史）、主题偏好、最近一次 Review 引用；`init()` 幂等加载 |
| `session.ts` | 当前审阅会话：原文、各类别状态、findings、报告；绑定领域日志、驱动 orchestrator、支持重启恢复与「清除并新建」 |
| `ui.ts` | 纯 UI 状态：当前页面（NewReview / Workspace / Settings）等 |
| `theme.ts` | 主题应用（spec: theme-system）：设计语言（swiss / apple）× 明暗组合 → `data-theme`；mount 前恢复，首帧即目标主题、无闪烁 |
| `onboarding.ts` | 首次运行引导状态（spec: onboarding-first-run）：完成标记持久化，重复启动不再弹出 |
| `update.ts` | 应用内自动更新状态机（spec: app-updates）：启动静默检查 + 设置页手动检查（静默路径吞错、手动路径可读错误）、用户确认后下载进度→验签→安装→重启；非 Tauri 环境整体 `unsupported` |

`*.test.ts` 为对应单测（vitest）。
