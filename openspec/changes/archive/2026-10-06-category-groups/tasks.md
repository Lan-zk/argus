## 1. 领域与数据层

- [x] 1.1 `src/domain/types.ts` 新增 `CategoryGroup` 类型、`ReviewCategory` 加 `groupId?: string | null`（null=通用），并补 `default-categories.ts` 内置类别 groupId 置空断言；验证 `npm test -- src/domain` 通过
- [x] 1.2 `src/lib/repo/migrations/` 追加 user_version 步骤（建 `category_groups` 表 + `categories` 加 `group_id` 可空列，user_version 最后写），追加 golden fixture 样本；验证 fixture 矩阵测试与 `npm test -- src/lib/repo` 通过
- [x] 1.3 `sqlite.ts` / `memory.ts` 实现组 CRUD 与类别归属读写（listGroups / insertGroup / renameGroup / moveGroup / deleteGroup 回落通用 / assignCategoryGroup），扩展 repo.contract 测试覆盖；验证 `npm test -- src/lib/repo` 通过

## 2. Store 层

- [x] 2.1 `settings.ts` 加 `groups` state 与统一 getter（通用虚拟置顶 + 自定义组按序）、组 CRUD actions（通用不可删不可改名）、`assignCategoryGroup`、新建/复制类别的默认归属逻辑；验证 `npm test -- src/stores` 通过
- [x] 2.2 删组回落与类别归属调整的 store 测试：组内类别回落通用后颜色/启停/默认选中/prompt 版本历史不变（对 `appendPromptVersion` 记录做回归断言）；验证对应测试文件通过

## 3. 设置页 UI

- [x] 3.1 `SettingsPage.vue` 类别列表按组分节展示（通用置顶），分组管理入口：新建、重命名、上移/下移、删除（确认文案含「N 个类别将移回通用」）；验证组件测试覆盖分节渲染与删组确认流
- [x] 3.2 类别编辑区新增「所属分组」选择器（通用 + 自定义组），调整后立即反映到分节与 New Review；验证组件测试断言归属变更后的列表重排

## 4. New Review UI

- [x] 4.1 `NewReviewPage.vue` 顶部组切换器（全部/通用/自定义组，无自定义组时不显示，空组置灰），「全部」视图按组分节且 defaultSelected 预选不变；验证组件测试覆盖切换器渲染与置灰
- [x] 4.2 切组替换勾选语义（点组 = 勾选集替换为该组 enabled 全集）与跨组自由加勾、「恢复默认」仅重置勾选不动视图；验证 `NewReviewPage.test.ts` 新增场景断言通过

## 5. 收尾与回归

- [x] 5.1 全量回归：`npm test` 与 `cargo test` 通过；`openspec validate category-groups` 通过
- [x] 5.2 同步文档：`src/lib/repo/README.md`（新表与迁移）、`src/stores/README.md`（组 actions）、`src/domain` 相应 README 若涉及；检查 UI 文案无中英混排
