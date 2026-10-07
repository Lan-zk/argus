## Context

类别现存储于 SQLite `categories` 表（`src/lib/repo/sqlite.ts`），`ReviewCategory` 为全局扁平列表（`src/domain/types.ts`），New Review 按 `enabled` 全量铺开勾选、`defaultSelected` 预选。动机见 proposal.md。约束：repo 层改动须走 app-persistence 存储迁移纪律（user_version 步骤 + golden fixture）；`review-versioning` 的 `category_prompt_versions` 与轮次快照结构不可破坏。

## Goals / Non-Goals

**Goals:**

- 类别获得单一分组归属（内置「通用」为虚拟组），设置页与 New Review 按组组织
- New Review 组切换器实现「替换式快捷勾选」，跨组自由加勾
- 存储迁移幂等可重放，旧库无损升级

**Non-Goals:**

- 不做多对多方案（一类别只属一组）、不做组内默认选中集
- 分组不进入审阅执行：orchestrator / 锚定 / 报告 / 轮次快照零改动
- 不做分组导出/分享（与 skill-packages 的包形态衔接由该变更自行定义）

## Decisions

### D1 组实体：「通用」虚拟化 + 组表 + 外键列

新表 `category_groups(id TEXT PK, name TEXT, sort_order INTEGER, created_at TEXT)`，`categories` 追加 `group_id TEXT NULL REFERENCES category_groups(id)`。**「通用」不落表行**：`group_id IS NULL` 即通用，组列表 = 虚拟通用 + 表行按 `sort_order`。

- 为什么虚拟化：恒在/置顶/不可删/不可重命名由构造保证（无行可删），store 层无需防御内置行被改；迁移也只需建表加列，不用预插种子行。
- 备选：通用组落行 + 删除保护。被否——保护逻辑散落 store/SQL 两层，且旧数据首迁要补插行。

### D2 删组回落 = 单条 UPDATE，不动类别其余字段

删除组时 `UPDATE categories SET group_id = NULL WHERE group_id = ?`，提示词版本表按 `category_id` 关联、与 `group_id` 无关，天然不受影响。删组在 store 层先行界面移除再落库（与现有类别删除一致的持久化节奏）。

### D3 切组勾选语义只活在 NewReviewPage 本地状态

组切换器是纯 UI 状态（当前视图组 id），勾选集仍是一个 `Set<categoryId>`；点组 = 用该组 `enabled` 类别 id 整体替换集合。「恢复默认」= 替换回 `defaultSelectedIds`，不动视图。不引入新的持久化偏好（进入页面恒为「全部」视图 + defaultSelected 预选，与现状一致）。

- 备选：记住上次使用的组。被否——先保持最小；若实际使用中发现切换频繁，再作为独立小需求补（不破坏本次结构）。

### D4 空组置灰由派生数据驱动

切换器项的可用性 = 该组是否存在至少一个 `enabled` 类别（computed 派生，无额外存储）。与「禁用类别不出现在选择列表」的既有语义自然衔接。

### D5 组列表顺序与「通用」置顶为展示层约定

`settings.groups` getter 统一输出 `[通用, ...自定义组按 sort_order]`，设置页分节与 New Review 切换器都消费同一 getter，避免两处各自排序漂移。

## Risks / Trade-offs

- [SQLite 加列不可 `IF NOT EXISTS`] → 迁移按 user_version 幂等（版本已过则跳过），符合 app-persistence 既有模式；golden fixture 追加含 `group_id` 的样本。
- [删组时用户误以为类别一起被删] → 删除确认文案明示「组内 N 个类别将移回通用」。
- [一类别一组的归属限制，未来想共享类别到多组] → 结构上外键单值；若将来需要多对多，可加关联表迁移，本次不为推测需求加复杂度。

## Migration Plan

1. `src/lib/repo/migrations/` 追加 user_version 步骤：建 `category_groups` 表（`IF NOT EXISTS`）+ `categories` 加 `group_id` 列（版本门槛保证只执行一次），`user_version` 最后写。
2. golden fixture 追加各历史版本脱敏样本（含新列）；fixture 矩阵测试与 CI 全量校验。
3. memory 实现（浏览器 dev 兜底）同步加组 Map 与 `group_id` 字段，行为与 sqlite 一致（repo.contract 测试覆盖）。
4. 回滚：`group_id` 为 NULL 容忍旧读，应用回退版本后旧代码忽略新列即可读（列可空、无 NOT NULL 约束），写路径不丢数据。
