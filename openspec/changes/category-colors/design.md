# category-colors — 技术设计

## Context

见 proposal「Why」。现状约束：`ReviewCategory.color?: string` 是单一字符串，全部下游（设置页 `.csq`、New Review 类别行、工作台 `colorMap`、FindingCard `--cc`、DocViewer `--u1..u3`、ReportView 色块）直接把该字符串塞进 CSS 颜色属性 —— 即任何合法 CSS 颜色即刻全局生效。内置 7 类存的是 `var(--c-*)` 引用（`default-categories.ts`），四主题令牌块提供成对取值且对比度已校验；`addCategory` 兜底 `var(--gray)`；`updateCategory` 已接受 `color` patch。

## Goals / Non-Goals

**Goals:**

- 自定义类别获得与内置类别同级的颜色配置体验：策展色板随主题走，自定义 hex 有低对比提示。
- 新建类别之间默认可区分（色板轮转兜底）。
- 复用既有资产：`.pop` 弹层样式与入场动效、令牌四块结构、对比度脚本、`updateCategory` 持久化。

**Non-alsGoals:**

- 不做每类别「亮/暗双值」的结构化存储方案（见 D1）。
- 不做类别颜色与 severity 颜色的联动或冲突检测（语义不同，允许同 hue 于不同元素）。
- 不改内置 7 类的颜色，不动复制/删除/排序逻辑。

## Decisions

### D1：存储格式沿用单一字符串 —— 色板存 `var(--pN)` 引用，自定义存 hex

- 备选 A：结构化 `{ light, dark }` 双值对象 —— 被否决：`color?: string` 被全部下游与持久化数据消费，改为对象需要动 6+ 个消费点与数据迁移，且用户自定义值仍需第三态。
- 备选 B：一律存 hex + 运行时按明暗派生 —— 被否决：派生算法（提亮/降饱和）无法保证四组合对比度，且与内置类别的令牌机制割裂。
- **选定**：色板选择存 `"var(--p3)"` 这类令牌引用（与内置 `"var(--c-logic)"` 完全同构，零迁移、天然随主题）；自定义存 `"#rrggbb"`（现有 spec 已声明原样保留）。缺色兜底 `var(--gray)` 继续有效。

### D2：调色板令牌 —— `--p1..--p10`，四主题块各一套，脚本定稿

- tokens.css 四块各加 10 个令牌；取值原则：从内置 7 类色相环（红/蓝/赭/紫/青绿/品粉/橙）的空档取 hue（绿、靛、青柠、天青、琥珀等），避免同 hue 撞色。
- 具体色值不手工拍板：初值写入后由 `contrast-check.mjs` 扩展规则（`--p*` 对 paper/card ≥3:1）迭代定稿 —— 与 theme-system 3.4 的既有工作法一致。
- 色相区分采用目检 + 脚本双保险：脚本校验对比度，撞色由四组合截图目检（既有 4.2 流程复用）。

### D3：弹层交互 —— 色块即按钮，复用 `.pop` 形态

- `csr-top` 的 `.csq` 从 `<span>` 改为 `<button class="csq-btn">`（保留色块视觉，加 hover/焦点态），点击弹出 `CategoryColorPicker` 弹层。
- 弹层定位在色块下方（`position:absolute`，行内相对定位容器内展开，不跨层级 —— csr 行自身无 overflow 裁剪，无需 portal）。
- 内容：当前色预览 + 10 色板网格 + 分隔 + 「自定义」`<input type="color">` 与对比度提示区。点选/输入即调 `updateCategory({color})` 并持久化（现有透明落盘链路）。
- 关闭：再次点击色块、点击弹层外、Esc 三者任一；无焦点陷阱需求（单控件弹层，Esc 可达）。
- 样式复用 `.pop` 毛玻璃与 `popin` 动效；动效自动受 `prefers-reduced-motion` 兜底。

### D4：自定义色对比度提示 —— 运行时计算，仅提示不阻断

- 对比当前解析后的 `--paper` 与 `--card` 计算选色 hex 的 WCAG 比值（复用/抽出 contrast-check 的纯函数逻辑到 `src/lib/`，弹层与脚本共用一份实现，避免两套算法漂移）。
- 低于 3:1 显示 ⚠ 与一行文案（「当前皮肤下对比度偏低」）；保存不被阻止（spec 措辞一致）。
- 提示随主题实时变化：切肤后已存固定色的类别不重新弹提示（提示只在选择时出现，存量数据不回溯校验 —— 避免对既有数据产生骚扰性警告）。

### D5：新建类别兜底色 —— 按现有自定义类别数轮转

- `addCategory` 未传 color 时：`--p[(existingCustomCount) % 10]`，连续新建自然错开；确定性公式（非随机），测试可断言。
- 不按「已占用色」做避让（复杂度不值当，轮转已满足可区分目标）。

## Risks / Trade-offs

- [风险] 色板初值对比度不达标 → 缓解：脚本硬校验（exit 1），实施任务里定稿后才算完成。
- [风险] 弹层在 csr 行内展开挤压布局 → 缓解：absolute 定位 + 父容器 `position:relative`，弹层不占文档流；四组合截图目检。
- [风险] 自定义固定色在暗色下低对比 → 接受（spec 已声明原样保留 + 选择时提示），不运行时改色。
- [取舍] 共用对比度函数引入 `src/lib/` 新模块 → 换取脚本与 UI 单一事实来源，值得。

## Migration Plan

- 无数据迁移：旧数据 `var(--gray)` / 未设色继续有效；新增令牌仅向前新增。
- 回滚：revert 即可，无持久化格式变更。

## Open Questions

- 10 个色板的具体色值 —— 架构无关，实施期由对比度脚本与四组合目检定稿（同 theme-system 3.4 先例）。
