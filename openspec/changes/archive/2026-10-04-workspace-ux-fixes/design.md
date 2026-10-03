# workspace-ux-fixes · Design

## Context

三处改动都停留在表现层（CSS 滚动模型 + 一个缺失的渲染属性），不触碰数据层与编排逻辑。现状关键事实：

- `.sidepane`（`base.css`）自身是 `overflow-y:auto` 的滚动容器，内部仅 `.side-tabs` 做了 `position:sticky`，`.filters` 与 `.cards` 一起滚动；报告页签的内容（`ReportView` 根节点 `.report`）也依赖 sidepane 整体滚动。
- `WorkspacePage.onCardSelect` 通过 `[data-block-id="${f.blockId}"]` 查找原文块，但 `DocViewer.vue` 渲染 `<component :is="rb.tag">` 时从未输出该属性，定位链路自 MVP 起从未生效；报告回跳（`onReportJump` → `onCardSelect`）同路径失效。
- 新建审阅页根节点是通用 `.page`（`overflow-y:auto` 整页滚动），`.new-wrap` 为 `grid-template-columns: minmax(0,1fr) 360px`；`textarea.doc-input` 只有 `min-height:420px` + `resize:vertical`，无上限。工作台页已有 `.page-ws.on{display:flex;overflow:hidden}` 的"页面不滚、栏内滚"先例可循。

## Goals / Non-Goals

**Goals**

- 右侧面板头部（页签 + 筛选条）冻结，卡片列表与报告内容各自滚动。
- 恢复点卡片/报告回跳 → 左侧原文滚动居中的既有契约。
- 新建审阅页双栏独立滚动，「开始审阅」任何输入框高度下可见。

**Non-Goals**

- 不改 Finding 定位算法（anchor 逻辑不动，只补渲染属性）。
- 不引入虚拟滚动/懒加载等列表性能优化。
- 不动 `.page-ws` 顶部状态栏/类别条的现有冻结行为（已正确）。
- 不做移动端专项适配，仅保留既有 ≤1000px 断点的合理回退。

## Decisions

### D1 · sidepane 用三段式 flex 替代 sticky，而非给 `.filters` 加 sticky

方案 A：保留 sidepane 整体滚动，给 `.filters` 追加 `position:sticky; top:<tabs高度>`。被否——tabs 高度在瑞士形态与 Apple 形态不同（Apple 的分段控件带 `margin:10px 12px`），硬编码偏移量脆弱。
方案 B（采用）：`.sidepane` 改 `overflow:hidden` + `display:flex; flex-direction:column`；`.side-tabs`、`.filters` 为 `flex:0 0 auto`（顺带移除现已无意义的 sticky）；`.cards` 为 `flex:1 1 auto; min-height:0; overflow-y:auto`。与 `.page-ws` 既有模式同构，主题无关。报告页签同样处理：`ReportView` 外包一层滚动容器（或直接让 `.report` 承担 `flex:1; overflow-y:auto`），二者取 DOM 改动更小的直接给 `.report` 加滚动样式。

### D2 · `data-block-id` 直接加在 `<component>` 渲染根上，不引入包裹元素

备选是给每块包一层 `<div data-block-id>`，但会破坏 `h1/h2/blockquote` 等标签的块级语义与既有 `.blk` 选择器样式。Vue 的 `<component>` 支持透传 attribute，`:data-block-id="rb.block.id"` 落在实际标签上，零样式影响。`onCardSelect` 现有守卫（`f.blockId` 为空的 unanchored Finding 直接跳过）保持不变。

### D3 · 新建审阅页复用 `.page-ws` 模式；按钮常驻采用 sticky + max-height 双保险

页面级：`NewReviewPage` 根节点追加 `page-new` class，`.page-new.on{display:flex;flex-direction:column;overflow:hidden}`，`.new-wrap` 拿 `flex:1;min-height:0`，`.new-left`/`.new-right` 各自 `overflow-y:auto`。
按钮常驻只做 sticky 会留一个漏洞（内容本身不超长时 sticky 无感，但输入框拖高仍可能把按钮顶出左栏可视区后 sticky 生效前难以感知）；只做 max-height 又限制不了"内容 + 提示文案累计超长"的场景。故两者并用：
- `.new-actions`（含开始审阅按钮）`position:sticky; bottom:0` + 不透明底色（覆盖滚过其下的内容），钉在左栏滚动区底部；
- `.doc-input` 增加 `max-height`（约 `calc(100vh - 偏移量)`，实测定值），`resize:vertical` 拖动在上限内仍可用，从源头保证按钮不被顶走。

### D4 · 窄屏回退：媒体查询内还原整页滚动

`@media(max-width:1000px)` 下 `.new-wrap` 已是单列；若左右两栏仍各自 `overflow-y:auto` 会出现"栏内滚动 + 无整页滚动"的嵌套体验。在该断点内把 `.page-new.on` 还原为 `overflow-y:auto`、两栏 `overflow:visible`，回到现状的整页滚动行为。

### D5 · 测试只锁属性与结构，不模拟滚动

jsdom 无真实布局，`scrollTo`/`scrollIntoView` 断言意义有限。测试锁定两件事：`DocViewer` 渲染输出包含 `data-block-id`（防止 bug 回归，挂在既有 `DocViewer.test.ts`）；新建页根节点具备 `page-new` class（结构性断言）。滚动行为本身靠 spec 场景描述 + 人工验收。

### D6 · 平滑滚动加环境退避（实现期补充）

浏览器验收发现：部分 WebView（本机验证环境，以及 macOS 旧版 WKWebView / Safari < 15.4）对 `scrollTo({behavior:'smooth'})` 完全不执行——既不动画也不跳转，定位会静默失效。因此 WorkspacePage 内统一走 `smoothScrollTop`/`scrollCenter` 助手：先发起平滑滚动，约 120ms 后位置仍无位移则退避为直接定位（`behavior:'auto'`）。三处调用点（点卡片定位原文、点高亮定位卡片、选中变化自动滚动）共用；spec 的「滚动到对应原文并居中」语义不受动画形式影响。

## Risks / Trade-offs

- [Apple 形态下冻结头部的视觉回归：分段控件 tab 带外边距，改 flex 后与筛选条的间距可能变化] → 实现后两套主题各过一遍视觉验收（swiss 默认 + apple light/dark）。
- [`.new-actions` sticky 底色若用 `var(--card)` 但左栏底色是 `var(--paper)`，滚动内容从按钮下方穿过时露馅] → 底色显式取左栏背景同值，或加 hairline 上边框做视觉分隔。
- [`.report` 直接改为滚动容器后，`WorkspacePage` 里对 sidepane 滚动位置的隐式假设（如 watch 中 `scrollIntoView` 的目标容器变化）] → `scrollIntoView` 会沿最近可滚祖先生效，`.cards` 成为容器后行为不变；实现时回归验证报告回跳路径。
- [`scrollIntoView({block:'center'})` 理论上会滚动所有可滚祖先] → 工作台页面本身 `overflow:hidden`，页面级不会被牵动；此为既有行为，非本次引入。

## Migration Plan

纯前端改动，无数据迁移。发布即生效；回滚 = revert 提交。分栏宽度持久化、草稿文本等既有持久化数据不受影响。

## Open Questions

（无。）
