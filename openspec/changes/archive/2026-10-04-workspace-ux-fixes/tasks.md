# workspace-ux-fixes · Tasks

## 1. Bug 修复：批注反定位原文

- [x] 1.1 在 `DocViewer.vue` 渲染块的 `<component>` 上补 `:data-block-id="rb.block.id"`，并在 `DocViewer.test.ts` 增加断言：每个渲染块输出对应 `data-block-id` 属性（验证：`npm test` 通过）
- [x] 1.2 手工回归验证定位链路（jsdom 无法验证滚动）：点右侧 Finding 卡片 → 左侧滚动到对应原文并居中高亮；点报告优先问题条目 → 同样回跳定位；unanchored 卡片点击仅选中不滚动（验证：`npm run dev` 人工验收）

## 2. 工作台右侧面板头部冻结

- [x] 2.1 重构 `base.css` 滚动模型：`.sidepane` 改 `overflow:hidden` + 三段式 flex，`.side-tabs`/`.filters` 定为 `flex:0 0 auto`（移除 side-tabs 的 sticky），`.cards` 改 `flex:1;min-height:0;overflow-y:auto`（验证：滚动卡片列表时页签与类别/严重度筛选条固定可见）
- [x] 2.2 为报告页签内容提供滚动容器：`.report` 承担 `flex:1;min-height:0;overflow-y:auto` 或等效包裹（验证：切到报告页签，长报告在面板内独立滚动、页签不滚走）
- [x] 2.3 两套主题视觉验收：瑞士默认与 Apple 明暗形态下，冻结头部（含 Apple 分段控件 tab）间距、边线无错位（验证：`npm run dev` 切主题逐项检查）

## 3. 新建审阅页双栏独立滚动与操作常驻

- [x] 3.1 `NewReviewPage.vue` 根节点追加 `page-new` class；`base.css` 增加 `.page-new.on` 页面级 `overflow:hidden` + `.new-wrap` 占满剩余高度、`.new-left`/`.new-right` 各自 `overflow-y:auto`，并在测试中断言根节点 class（验证：`npm test` 通过 + 两栏各自出现独立滚动条）
- [x] 3.2 「开始审阅」常驻：`.new-actions` 加 `position:sticky;bottom:0` 与不透明底色（含上边线分隔），`.doc-input` 增加 `max-height` 上限（验证：把输入框拖到上限，按钮始终在左栏可视区域内可见可点）
- [x] 3.3 窄屏回退：`@media(max-width:1000px)` 内 `.page-new.on` 还原整页滚动、两栏取消独立滚动（验证：窗口缩到 ≤1000px，页面整体滚动、无嵌套滚动条）

## 4. 收尾

- [x] 4.1 全量回归：`npm test` 与 `npm run build` 通过；工作台核心路径（新建审阅 → 开始 → 工作台滚动/筛选/定位/报告回跳）人工过一遍（验证：命令输出与验收记录）
