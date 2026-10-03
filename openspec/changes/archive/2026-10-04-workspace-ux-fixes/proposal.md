# workspace-ux-fixes

## Why

审阅工作台与新建审阅页存在两处滚动模型缺陷和一处定位失效 bug：右侧批注面板滚动时「类别/严重度」筛选条会跟着卡片一起滚走，筛选入口不可常驻；新建审阅页左右两栏共用一条页面滚动条，且原文输入框可被拖高到把「开始审阅」按钮推出视口；点 Finding 卡片反向定位原文的代码因缺少 `data-block-id` 渲染属性而从未生效（连带报告回跳一起失效），违反既有 spec 要求。

## What Changes

- **修复 bug：点卡片/报告回跳定位原文失效。** `DocViewer.vue` 渲染块时补上 `data-block-id` 属性，使 `WorkspacePage.onCardSelect` 的 `querySelector` 能命中目标块，恢复「左侧滚动到对应原文并居中高亮」与报告条目回跳。无 spec 文本变更（恢复 `review-ui`「高亮与双向定位」与 `review-report`「回跳交互」既有要求的行为）。
- **工作台右侧面板改为头部冻结三段式。** `.sidepane` 从整体滚动改为：页签（批注/报告）与筛选条（类别/严重度）固定不滚，仅 Finding 卡片列表独立滚动；报告页签内容获得自己的滚动容器（现在依赖 sidepane 整体滚动，改后不套容器会被裁切）。
- **新建审阅页改为双栏独立滚动 + 操作常驻。** 页面本身不再滚动；左栏（原文输入）与右栏（Review Category）各自独立滚动；「开始审阅」按钮钉在左栏底部常驻可见（`position: sticky; bottom: 0`），同时给输入框加 `max-height` 上限，从源头阻止拖高推出视口。窄屏（≤1000px）单列布局回退为整页滚动。

## Capabilities

### New Capabilities

（无。）

### Modified Capabilities

- `review-ui`: 「双栏布局与独立滚动」需求增加右侧面板头部冻结契约 —— 页签与筛选条 MUST 固定不随卡片列表滚动，卡片列表与报告内容各自独立滚动；新增「新建审阅页双栏独立滚动与操作常驻」需求 —— 左右两栏独立滚动、开始审阅按钮常驻可见、窄屏回退整页滚动。

（`review-report` 的「回跳交互」仅受 bug 修复影响、无 spec 文本变更，不列入。）

## Impact

- `src/components/DocViewer.vue` — 渲染块时输出 `data-block-id`（bug 修复核心，一行属性）。
- `src/styles/base.css` — `.sidepane`/`.filters`/`.cards` 滚动模型重构；报告滚动容器样式；`.page-new` 页面级 `overflow:hidden` + `.new-left`/`.new-right` 独立滚动；`.doc-input` max-height；`.new-actions` sticky；窄屏媒体查询回退。
- `src/pages/NewReviewPage.vue` — 根元素加 `page-new` class（与 `.page-ws` 同模式）。
- `src/pages/WorkspacePage.vue` — 预期不需改逻辑（定位代码已就绪，等待属性存在）；报告滚动容器可能需包一层。
- 测试 — 补 DocViewer 渲染 `data-block-id` 的断言；无既有测试覆盖点卡片滚动行为（无 WorkspacePage.test.ts）。
