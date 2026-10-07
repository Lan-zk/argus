## Why

Review Category 目前是全局扁平列表：跨文稿类型（小说、讲道稿、议论文……）的类别混在一处，每次换类型都要手动勾掉一批、再勾上一批；skill-packages 落地后「一个包生成 N 个类别」会让混排更严重。需要按文稿类型把类别组织成组，并在 New Review 提供快捷切换。

## What Changes

- 新增**类别分组（Category Group）**：每个类别归属于一个组；内置类别与用户新建类别默认入「通用」组，用户可随时把类别划归到自己维护的组
- 分组管理：新建组、重命名、排序、删除；删除组只解除归属，所属类别回落「通用」，MUST NOT 删除类别
- New Review 顶部新增**组切换器**：点某组 = 把当前勾选**替换**为该组全部 enabled 类别；分组是快捷入口而非互斥边界，切换后仍可手动增减、跨组自由加勾
- 「全部」视图（默认）：类别按组分节展示，预选沿用现状 `defaultSelected` 语义不变
- 分组不进入审阅执行：已勾选类别无论来自哪个组，编排、锚定、报告行为与现状一致；轮次 categorySnapshot 结构不变

## Capabilities

### New Capabilities

（无——分组行为拆入既有两个能力的规格）

### Modified Capabilities

- `settings`: 「Review Category 管理」扩展——分组 CRUD、类别归属调整、新建/内置类别默认入通用、删组回落语义
- `review-ui`: 「类别选择」扩展——组切换器、切组勾选语义（替换为该组 enabled 全集）、跨组自由勾选、「全部」分节视图

## Impact

- **数据**：`categories` 表加组归属列 + 新增组表（或组随 settings 存储落位，见 design）；按 app-persistence 存储纪律走 user_version 迁移 + golden fixture
- **代码**：`src/domain/types.ts`（ReviewCategory 增组归属、CategoryGroup 类型）、`src/lib/repo/`（迁移 + memory/sqlite 实现）、`src/stores/settings.ts`（组 CRUD 与归属操作）、`src/pages/NewReviewPage.vue`（组切换器）、`src/pages/SettingsPage.vue`（分节与组管理）
- **不动**：orchestrator / ai / finding 链路（分组只是选择辅助，不进审阅执行）；`review-versioning` 的轮次快照与提示词版本表
- **实施顺序**：本变更先于 skill-packages；skill-packages 的导入映射同步改为「包内类别按包名自动建组」（其 proposal/design 已随本变更更新）
