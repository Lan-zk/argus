---
name: Argus
description: A personal AI document-review workbench in a dual-theme editorial design system — Swiss International Style (default) and an Apple-voiced skin; ink-and-paper surfaces, one brand accent per theme, red reserved for danger, findings anchored to the manuscript.

colors:
  # swiss-light（默认皮肤，:root）
  paper: "#f5f3ee"
  paper2: "#ebe8e0"
  card: "#fdfcf9"
  pearl: "#fdfcf9"
  ink: "#17150f"
  accent: "#e2231a"
  danger: "#a3120b"
  cta: "#e2231a"
  ochre: "#8a6300"
  gray: "#5b6470"
  ok: "#0d7a68"
  on-accent: "#ffffff"
  on-danger: "#ffffff"
  # apple 皮肤签名色（完整四组合取值见 src/styles/tokens.css）
  apple-canvas: "#f5f5f7"
  apple-card: "#ffffff"
  apple-ink: "#1d1d1f"
  apple-accent: "#0066cc"
  apple-accent-dark: "#2997ff"
  apple-danger: "#d70015"
  apple-pearl: "#fafafc"

typography:
  display:
    fontFamily: "Helvetica Neue, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: 25px
    fontWeight: 700
    lineHeight: 1.35
  headline:
    fontFamily: "Helvetica Neue, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: 19px
    fontWeight: 700
    lineHeight: 1.4
  title:
    fontFamily: "Helvetica Neue, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: 14px
    fontWeight: 700
    lineHeight: 1.5
  body:
    fontFamily: "Helvetica Neue, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.65
  reading:
    fontFamily: "Helvetica Neue, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: 16.5px
    fontWeight: 400
    lineHeight: 1.95
  label:
    fontFamily: "Helvetica Neue, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: 10px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0.18em
  form-label:
    fontFamily: "Helvetica Neue, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: 0.06em
  button:
    fontFamily: "Helvetica Neue, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0.05em
  mono-data:
    fontFamily: "SF Mono, Menlo, Consolas, monospace"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.5

rounded:
  none: 0px
  apple-sm: 8px
  apple-card: 18px
  apple-pill: 9999px

components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.none}"
    padding: 7px 16px
  button-primary-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
  button-default:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.none}"
    padding: 7px 16px
  button-apple-primary:
    backgroundColor: "{colors.apple-accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.apple-pill}"
    padding: 11px 22px
  input-text:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: 7px 10px
  finding-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: 13px 15px
  filter-chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: 3px 10px
  badge-sev-high:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-danger}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: 2px 8px
  sidebar-row-active:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
---

# Design System: Argus

## 1. Overview

**Creative North Star: "排字工的工作台"（The Typesetter's Workbench）**

Argus 是一个文档审阅工具，设计语言取瑞士国际主义的编辑部气质：网格、墨线、单色加一点红。信息密度是特性而非缺陷——这是 product register 的界面，工具应消失于任务，稿件永远是画面主角。Apple 皮肤是同一座工作台的「家用 Hi-Fi」形态：同一信息结构、布局与交互，换成 parchment 画布、珍珠胶囊、发丝线与系统蓝。**主题换的是腔调，不是内容。**

架构上这是双轴主题系统：theme（swiss / apple）× appearance（light / dark / system）合成为 `<html data-theme>` 四组合，颜色令牌按组合全量定值，形状令牌只随主题轴（swiss 全 0 圆角；apple 18 / 8 / 全胶囊）。基础样式层写瑞士语法，Apple 差异走 `[data-theme^="apple"]` 覆盖层。frontmatter 里的令牌取默认皮肤 swiss-light（`:root`）；apple 签名色以 `apple-` 前缀并列收录。深入的过程契约（评审门禁、新主题接入清单）见 `design/DESIGN-GUIDE.md`，Apple 取值的外部分析见 `design/Apple-design-analysis.md`。

**Key Characteristics:**
- 编辑部式密度：双栏工作台（原文高亮 + finding 卡片）、每镜头一格的 runstrip、mono 数据编号。
- 每主题一个品牌强调色（swiss 红 `#e2231a` / apple Action Blue `#0066cc`），红色恒为 `--danger` 语义。
- 瑞士皮肤：直角、1.5–2px 墨线、hover 墨纸反转、唯一硬偏移投影（浮层）。
- Apple 皮肤：chrome 零阴影、发丝线分隔、macOS 磨砂浮层（毛玻璃 + 系统菜单影 + 菜单 accent 选中）、侧栏 accent 淡填充选中、按压 scale(.95)。
- 动效共享一套 ease-out 曲线与三档时长（反馈 ~150ms / 状态 200–250ms / 到场 ≤300ms），reduced-motion 全局兜底。

## 2. Colors: The Ink-and-Paper Palette

调色板是「纸与墨」：暖纸画布 + 近黑墨 + 每主题唯一品牌色。角色语义跨主题不变，取值按四组合各自定值（真身在 `src/styles/tokens.css`）。

### Primary
- **Swiss Red**（`{colors.accent}` — #e2231a，暗面 #ff5548）：瑞士皮肤唯一品牌强调——选中态、主按钮 hover、块编号、tab 红条。使用面积 ≤10%，稀有其价值。
- **Action Blue**（`{colors.apple}` — #0066cc，暗面 Sky Blue #2997ff）：Apple 皮肤的对应物，明暗同用于 CTA；暗面链接用 Sky Blue。

### Neutral
- **Warm Paper**（`{colors.paper}` — #f5f3ee）：画布底。次级画布 Deckle（`{colors.paper2}` — #ebe8e0）用于代码块与 hover 着色。
- **Loose-Leaf Card**（`{colors.card}` — #fdfcf9）：卡片与输入件底，比纸更亮半档。
- **Letterpress Ink**（`{colors.ink}` — #17150f）：全部文字与结构线，非纯黑（印刷感）。透明度阶梯 ink70/50/35/15 承担次级文本、微标签、边框、发丝分隔；ink50 亦达正文级 AA（≥4.5:1，四组合由对比度脚本硬校验），ink35 只做边框与发丝、不承载文本。
- **Parchment**（`{colors.apple-canvas}` — #f5f5f7）与 **Apple Ink**（#1d1d1f）：Apple 亮面的画布与墨；暗面用近黑微阶 tile（#272729/#252527/#2a2a2c）分层而非纯黑。

### Semantic
- **Danger Oxide**（`{colors.danger}` — #a3120b，apple 亮 #d70015 / 暗 #ff453a）：错误、失败、severity-high——任何主题下恒红。
- **Ochre**（#8a6300）severity-medium；**Slate Gray**（#5b6470）severity-low；**Verdigris**（#0d7a68）成功。
- 类别色 `--c-*` 七个（logic/thesis/argument/rhetoric/structure/clarity/speech）与自定义调色板 `--p1…p10`：每组合独立定值，暗面整体重调。

### Named Rules
**The Red Means Stop Rule.** 红色只承载错误语义（`--danger`），品牌强调走 `--accent`；swiss 下两者色值相近是双义陷阱，代码中不得混用。
**The Paired Skins Rule.** 任何颜色改动必须四组合同审并通过 `node scripts/contrast-check.mjs`（正文 ≥4.5:1，图形/强调 ≥3:1，exit 1 为门禁）。

## 3. Typography

**Display / Body Font:** Helvetica Neue, PingFang SC, Noto Sans SC, sans-serif（apple 皮肤换 system-ui / SF Pro 栈）
**Label / Mono Font:** 同族；数据一律 SF Mono, Menlo, Consolas（`{typography.mono-data}`）

**Character:** 单家族多字重的编辑部排印。瑞士皮肤标题 700 加粗、正文宽松行距；Apple 皮肤字重阶梯 300/400/600/700（500 缺席）、标题 600 + 负字距、区块标题步进至 21px、正文 17px/1.47/-0.374px（DESIGN 规定的阅读节奏）。两个皮肤级例外：数据统计大数字（`.bar .n` 21px mono）与装饰性锚点/英文栏小注（9px，不承载实义信息）。

### Hierarchy
- **Display**（700，25px，1.35）：文稿 H1 与页面主标题。
- **Headline**（700，19px，1.4）：区块标题（sec-head）；带 mono 编号前缀（`--accent`）。
- **Title**（700，14px，1.5）：卡片标题、行内强调（apple 下 600 + -0.224px）。
- **Body**（400，13px，1.65）：界面默认文本；卡片正文 12.5px/1.65–1.7。
- **Reading**（400，16.5px，1.95）：文稿栏正文——长文阅读的宽松行距（apple 下 17px/1.47），栏宽锁 720px。
- **Label**（600，10px，0.18em，大写）：microlabel 栏目标记——装饰性用途，不承载实义信息。
- **Form-label**（600，11px，0.06em，正常大小写）：表单与筛选字段的实义标签（`.flabel`；存量表单容器内的 microlabel 由上下文规则降级为该形态）。
- **Mono-data**（400，11px）：块编号、计数、状态、时间戳。

### Named Rules
**The Mono Is Data Rule.** 等宽字体只用于可数的数据（编号/计数/状态/哈希）；它是文档栏的视觉锚点，不是装饰。

## 4. Elevation

系统默认平面。深度由表面色阶（paper → card、apple 暗面 tile 微阶）与线宽表达，不靠投影。

### Shadow Vocabulary
- **Pop Hard-Offset**（`6px 6px 0 rgba(23,21,15,0.15)`）：瑞士皮肤唯一的投影，只用于浮层 `.pop`——印刷套版错位隐喻。卡片、按钮、文字一律无影。
- **Apple: zero chrome shadows**：Apple 皮肤连这唯一的投影也归零（`--shadow-pop` 透明）；浮层改毛玻璃（parchment 82% + `saturate(180%) blur(20px)` + 1px 发丝边）并加 **macOS 系统菜单影**（`0 6px 18px rgba(0,0,0,.14), 0 1px 3px rgba(0,0,0,.08)`）——浮层是窗口语义，是 chrome 零阴影原则的唯一登记例外；撤销浮条同为磨砂玻璃胶囊卡（macOS 通知形态）。

### Named Rules
**The Flat-By-Default Rule.** 平面是默认；投影是主题语言的一部分（swiss 的一处硬偏移 / apple 的零投影），不是状态工具。禁止给卡片、按钮、文字新增装饰性阴影或玻璃。

## 5. Components

组件词汇在两套皮肤下同构异形——同一状态机，不同方言。形状全部走 `--radius*` 令牌（自动随主题）。

### Buttons
- **Shape:** 瑞士直角（`{rounded.none}`）；apple 工具件 8px、CTA 全胶囊（`{rounded.apple-pill}`）。
- **Primary:** 瑞士 = 墨底纸字（`{component.button-primary}`），hover 换 Swiss Red；apple = Action Blue 全胶囊（`{component.button-apple-primary}`，17px），hover 加深 12%。
- **Default:** 卡底 + 1.5px 墨边（apple：珍珠底 + 3px 软环）。
- **Active:** 瑞士 `translateY(1px)`（1px 下沉）；apple `scale(.95)`。**Focus:** 2px `--accent-focus` outline + 2px offset（swiss 下该令牌为墨色，与错误红区分；apple 为 Focus Blue）。CTA 按压加深用派生令牌 `--cta-hover`。
- **Danger:** 描边红字；hover 红 （apple 幽灵态只加 10% 红底）。

### Inputs / Fields
卡底、1.5px `--ink35` 边（apple 1px）、内距 7px 10px。聚焦换 `--accent` 边 + focus-visible 时 2px 焦点环（apple 为 3px 25% 光环）。复选框 15px，选中态 `--accent` 填充 + 打勾动画。

### Cards / Containers
- **Finding Card**（`{component.finding-card}`）：1px `--ink15` 边、卡底、13px 15px 内距；hover 边框加深，选中 2px outline（swiss `--accent` / apple `--accent-focus`）。内部无嵌套卡片——用 hair 分隔与字段标签组织。
- **unanchored 态**：虚线边 + 纸底，诚实标注「未锚定」。
- **原文引用块**：类别色 10% 着色底（`color-mix`），非侧条。

### Navigation
- **侧栏 = chrome（无全局顶栏）**：品牌 / 新建审阅 / 分组项目列表 / 底部固定账户行（默认模型 + 就绪点）全在第一栏；折叠（⌘B）后主区左上角常驻展开入口。
- **瑞士**：侧栏头部下边线 6px 实墨（原顶栏墨线语言）；活动行 = 卡底 + inset 2px 墨条；mono 轮次计数与运行脉冲点。
- **Apple**：头部下边线换发丝线；活动行 = accent 10% 淡填充 + 标题 accent 色（macOS 侧栏选中语法）；右栏页签换分段控件（灰轨白片）。

### Chips
- **Filter Chip**（`{component.filter-chip}`）：1px `--ink35` 边；选中 = 墨底纸字（apple：CTA 蓝填充全胶囊）。
- **Severity Badge**（`{component.badge-sev-high}`）：high = danger 填充；medium = ochre 描边；low = gray 描边。
- **Category Tag**：9px 色块 + 10.5px 700 标签，色值走 `--c-*`/`--p*`。

### Signature: Runstrip 与文档锚定高亮
- **Runstrip**：每审阅镜头一格的运行条——1px 网格并置（`--ink15` 底 + 1px gap），格内类别色块 + 状态（mono）。镜头可配置是产品主张，runstrip 是它的界面化身。
- **锚定高亮**：`.hl` 用 `box-shadow inset` 叠加类别色下划线（u1/u2/u3 三层），选中加 2px outline；点击卡片与原文互跳不改变原文滚动位置。

## 6. Do's and Don'ts

### Do:
- **Do** 组件层只写 `var(--token)`——颜色字面量只允许出现在 `src/styles/tokens.css`。
- **Do** 新组件从既有方言找语法：容器抄 finding-card，操作抄 button 体系，标签抄 microlabel，数据抄 mono 用法。
- **Do** 用透明度阶梯（ink70/50/35/15）表达文本层级，用线宽表达结构重量（swiss），用发丝线做弱分隔（apple）。
- **Do** 交互件齐备 default / hover / focus-visible / active / disabled，键盘可达、状态变更 aria-live 播报。
- **Do** 中文为主：界面文案、状态、徽标一律中文，禁双语混排。
- **Do** 改颜色后立即跑 `node scripts/contrast-check.mjs`，四组合全绿再提 PR。

### Don't:
- **Don't** 出现**聊天机器人感**（PRODUCT.md 反参照）：气泡对话流、emoji 装饰、拟人化助手人设——审阅是批注不是聊天。
- **Don't** 出现**企业后台 CRUD 感**（PRODUCT.md 反参照）：表单堆叠、管理列表、权限树。
- **Don't** side-stripe（>1px 的彩色左边/侧条纹）；历史上命中 4 处已改写，不许回潮。
- **Don't** 渐变文字、装饰性玻璃拟态（毛玻璃只属于 apple 浮层）、嵌套卡片、每节挂 eyebrow/编号标记。
- **Don't** 混用 `--accent` 与 `--danger`；瑞士皮肤红双义，错误语义一律 `--danger`。
- **Don't** 实义文本小于 10px；microlabel 是栏目标记不是正文。
- **Don't** animate 布局属性；一切动效走 transform/opacity + 颜色过渡，配 reduced-motion 兜底。
- **Don't** 发明中间圆角值——apple 语法只有 8 / 18 / 全胶囊三档，swiss 只有 0。
