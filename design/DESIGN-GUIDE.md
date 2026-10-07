# ARGUS 设计指南 — 双主题体系

本文是 ARGUS 界面设计的**遵循文档**：评审拿 §9 当合并门禁，开发拿 §3/§7/§8 当编码约束，设计新界面或新皮肤拿 §4–§6 与 §10 当语言规范和接入契约。

与相邻文档的分工：

| 文档 | 管什么 |
| --- | --- |
| 本文 | 本项目双主题体系「应该长什么样、怎么长得对」——令牌契约、两套皮肤的语言规范、跨主题不变量、新主题接入契约、评审门禁 |
| 根目录 [DESIGN.md](../DESIGN.md) | 设计系统的**规范格式快照**（YAML 令牌 + 六节，配套 `.impeccable/design.json` 边车；本文的机器可读投影，`$impeccable document` 再生成） |
| [`Apple-design-analysis.md`](./Apple-design-analysis.md) | Apple 设计语言的**外部分析**（apple 皮肤全部取值的依据，只读参照，不是本文的替代） |
| [`02-产品交互原型.html`](./02-产品交互原型.html) | 瑞士皮肤的**迁移源**（token 与基础样式出自这里，历史参照） |
| [`openspec/specs/theme-system`](../openspec/specs/theme-system/spec.md) | 主题系统的**行为规格**（双轴选择、持久化、无闪烁等 MUST/SHALL） |
| [`src/styles/tokens.css`](../src/styles/tokens.css) | 令牌的**唯一真身**（本文引用的值如与代码冲突，以代码为准并回来修本文） |

---

## 1. 设计立场

**Creative North Star: 「排字工的工作台」** —— ARGUS 是一个文档审阅工具，设计语言取瑞士国际主义的编辑部气质：网格、墨线、单色 + 一点红，信息密度是特性而不是缺陷。Apple 皮肤是同一座工作台的「家用 Hi-Fi」形态：同一信息结构，换成珍珠圆角、发丝线与系统蓝。**两个皮肤改的是「腔调」，不是「内容」**——布局、密度、信息层级、交互行为在所有皮肤下一致。

- Register 是 **product**（设计服务任务）：工具应消失于任务。熟悉感是优点，一致性压倒惊喜。
- 密度合法：工作台是双栏多卡的信息界面，允许紧凑，但不允许噪点（见 §8 字号底线）。
- AI slop test：任何一个皮肤如果让人一眼断定「AI 做的」，即失败。共享禁令见 §8，历史命中记录见 `.impeccable/critique/`。

## 2. 主题架构

**双轴偏好 → 单一皮肤**。用户选择 theme（`swiss` | `apple`）× appearance（`light` | `dark` | `system`），`resolveTheme()`（[src/lib/theme.ts](../src/lib/theme.ts)）合成为四个平铺皮肤之一，写在 `<html data-theme="…">` 上，同时设置 `color-scheme`：

```
swiss-light(:root 默认) / swiss-dark / apple-light / apple-dark
```

三条铁律：

- **`:root` 即默认皮肤**。swiss-light 的令牌直接定义在 `:root`，系统为亮色时的首屏与「无主题系统」时代完全一致。
- **令牌块平铺、无级联依赖**。四个块各自全量定值，不靠覆盖顺序；`resolveTheme` 只写一个属性。
- **形态差异分两层**。基础层（无 data-theme 选择器的规则）只写瑞士语法；Apple 的形态差异走 `[data-theme^="apple"]` 覆盖层（base.css 末段的「Apple 形态层」）。新皮肤同理（§10）。

样式落点共三层，职责固定：

| 层 | 文件 | 职责 | 允许出现的东西 |
| --- | --- | --- | --- |
| 令牌层 | `src/styles/tokens.css` | 颜色/形状/字体/动效曲线的**全部字面值** | 颜色 hex、rgba、radius、字体栈、缓动函数 |
| 基础层+覆盖层 | `src/styles/base.css` | 全局元素与通用组件类的 swiss 基础样式；主题覆盖层段 | `var(--token)`、结构属性（布局/边距/边框宽度） |
| 组件层 | `src/components/*.vue`、`src/pages/*.vue` scoped | 组件私有结构与状态样式 | `var(--token)`；**颜色字面量禁止**（白名单例外见 §3） |

启动链路（改启动逻辑时不得破坏）：`main.ts` 在 `app.mount()` **之前** `settings.init()` → `themeStore.start()`（mount 前写入 data-theme，首帧即目标皮肤，无闪烁）；`themeStore` 内 `matchMedia` 监听系统明暗，偏好或系统变化经 `watchEffect(flush:"sync")` 立即重解析，不产生中间帧。

## 3. 令牌契约

### 语义令牌（改令牌前先读这张表）

| 令牌 | 语义 | 约束 |
| --- | --- | --- |
| `--accent` / `--accent-focus` | 品牌强调 / 焦点环专用 | **随主题走**（swiss 红 `#e2231a`/暗面 `#ff5548`；apple Action Blue `#0066cc`/暗面 Sky `#2997ff`）。focus 变体只画焦点环；swiss 下 focus 取**墨色**（亮 `#17150f`/暗 `#ece9e2`，评审 2026-10：焦点与错误红区分），apple 取 Focus Blue（亮 `#0071e3`/暗 Sky） |
| `--danger` | 错误 / 失败 / severity-high | **恒红系，任何主题不得改语义**。swiss 亮 `#a3120b`、apple 亮 `#d70015`、apple 暗 `#ff453a` |
| `--cta` / `--on-cta` | 填充式主按钮底/字 | apple 明暗同用 Action Blue（Apple-design-analysis 规定）；swiss 同 accent。按压加深用派生令牌 `--cta-hover`（`--cta` 88% 混墨，apple 主按钮 hover 与撤销浮条按钮共用，字面值只出现在 tokens.css） |
| `--paper` / `--paper2` / `--card` | 画布 / 次级画布 / 卡面 | 皮肤气质的主要载体；apple-dark 用近黑微阶（`#272729`/`#252527`/`#2a2a2c`）而非纯黑 |
| `--ink` / `--ink70` / `--ink50` / `--ink35` / `--ink15` | 正文 / 次级文本 / 微标签与次要说明 / 边框 / 发丝分隔 | 透明度阶梯合成于主 ink；ink70 与 ink50 均达正文级 AA（4.5:1，contrast-check 硬校验），**ink35 只做边框与发丝、禁承载文本** |
| `--pearl` / `--ring-soft` / `--pearl-ink` | 珍珠按钮三件套 | apple 按钮语法的默认形态 |
| `--shadow-pop` | 浮层投影 | swiss 硬偏移 `6px 6px 0`；apple 归零透明（chrome 零阴影） |
| `--hair` | 1px 发丝线 | 跨主题的弱分隔 |
| `--c-*`（7 个） | 内置类别色 | 每组合独立定值；**暗面必须整体重调，禁止沿用亮色值** |
| `--p1`…`--p10` | 自定义类别调色板 | 每组合独立定值，且与内置 7 类不同 hue（不撞色） |
| `--radius` / `--radius-sm` / `--radius-round` / `--radius-cta` | 卡 / 工具件 / 圆形件 / CTA | **只随主题轴**：swiss 全 0；apple `18px`/`8px`/`9999px`/`9999px` |
| `--sans` / `--mono` | 正文字体 / 等宽 | swiss：Helvetica Neue 栈；apple：system-ui/SF Pro 栈。mono 共享，编号/计数/状态专用 |
| `--ease-out-quint` / `--ease-out-expo` | 动效曲线 | **跨主题共享**，禁 bounce/elastic |

### 铁律

**The Token Rule（令牌即法律）.** 组件层与基础层只写 `var(--token)`；颜色字面量只允许出现在 `tokens.css`。现存唯一白名单是 `CategoryColorPicker.vue` 的中性 fallback `#888888`（用户自定义色的输入缺省，非皮肤色）。新代码出现 hex/rgb 即违规，评审打回。

**The Paired Skins Rule（明暗成对）.** 任何颜色令牌的改动必须在全部组合下审视——改一处颜色等于改四张皮。改完跑 `node scripts/contrast-check.mjs`（§9）。

**The Red Means Stop Rule（红只报警）.** `--danger` 恒红且只承载错误/失败/高危。swiss 下 accent 恰好也是红——**这是双义陷阱**：代码里凡错误语义一律 `--danger`，凡品牌语义（选中、强调、hover 反转、编号）一律 `--accent`，不得因为色值相近而混用（历史事故：accent≡danger 曾导致语义审查扣分）。

## 4. 瑞士风格（默认皮肤）

**一句话**：Helvetica + 网格 + 墨线的国际主义排版——纸感画布（`#f5f3ee`）、近黑墨（`#17150f`）、一点正红、直角硬边、硬偏移投影。

核心词汇（基础层的既定语法，新组件必须沿用同一方言）：

- **结构 = 粗墨线**。侧栏头部下边线 6px 实墨（settings-in-sidebar 后原顶栏墨线转移至此）；文档栏与右栏之间以 6px 拖拽把手为**唯一**分隔（可拖、hover 变 accent，layout 优化后去掉叠加的 2px 边线）；报告节标题、表格表头带 2px 墨底线。粗线只画**结构分隔**，不画装饰。
- **边框语言**：按钮 1.5px 实墨边；输入件 1.5px `--ink35`；卡片 1px `--ink15`。宽度即层级：越重的结构线越粗。
- **hover = 墨纸反转**。按钮 hover 变墨底纸字；active `translateY(1px)`（1px 下沉，物理按压感）。
- **投影只此一处**：`--shadow-pop`（`6px 6px 0` 硬偏移）用于 `.pop` 浮层——印刷套版错位的隐喻。卡片、按钮、文字一律无影。
- **microlabel**：10px / 0.18em / 大写 / 600——编辑部的栏目标记，只用于装饰性标签与英文小注，**不承载实义信息**。
- **等宽即数据**：块编号、计数、状态、时间戳一律 `--mono`（红色块编号 `--accent` 是文档栏的视觉锚点）。
- **类别墨线**：runstrip 每格底 3px 类别色线，状态即墨线——pending 12% 虚位轨道（色块减淡）、running 22% 轨道 + 色段循环滑行、completed 落墨从左压满（六镜头全部完成后连成一条六色墨线，是工作台的收束记忆点）、failed 红虚线断线（与 unanchored 卡同用 dashed 方言）。数据记号，两皮肤同形；格子用 `repeat(auto-fit, minmax(150px,1fr))` 保证六格同行。
- **形状**：全 0 圆角，直角即立场。
- 正文（文档栏）16.5px / 1.95 行高，宽松行距服务长文阅读。

## 5. Apple 风格

**一句话**：[Apple-design-analysis.md](./Apple-design-analysis.md) 分析的 Apple 语言落到工具界面——parchment 画布（`#f5f5f7`）、珍珠胶囊、发丝线、纯黑全局导航、零 chrome 阴影、单一 Action Blue。全部取值以该分析为准，冲突时以它为准。

核心词汇（`[data-theme^="apple"]` 覆盖层的既定语法）：

- **圆角语法**：卡片 `18px` / 工具件 `8px` / CTA 与圆件全胶囊。珍珠按钮 11px + 3px `--ring-soft` 软环（ring 不是线）。不发明中间值。
- **chrome 零阴影**：卡片/按钮/文字一律无投影；浮层 `.pop` 走毛玻璃（`--paper` 82% + `saturate(180%) blur(20px)` + 1px 发丝边）。
- **分隔 = 发丝线**：所有 swiss 的 2px 墨线（文档栏分隔、heading2 顶线、报告节线、表头线）降为 1px `--ink15`。
- **按钮三档**：默认 = 珍珠胶囊（14px/400）；primary = Action Blue 全胶囊（17px，`--cta`）；danger = 幽灵描边。按压 `scale(.95)`（系统级微交互）。
- **侧栏 = chrome（无全局顶栏）**：品牌/新建/项目列表/底部账户行全在第一栏；头部下边线为发丝线。
- **macOS 磨砂三件套**（settings-in-sidebar D4，浮层=窗口语义）：浮层 `.pop` 毛玻璃 + **系统菜单影**（`0 6px 18px rgba(0,0,0,.14), 0 1px 3px rgba(0,0,0,.08)`，chrome 零阴影的唯一例外）；菜单项 hover = accent 填充白字（macOS 菜单选中语法）；撤销浮条 = 磨砂玻璃胶囊卡（`--card` 72% + blur/saturate + 发丝边 + 菜单影 + 14px 圆角）。侧栏选中行 = accent 10% 淡填充 + 标题 accent 色（macOS 侧栏选中语法）。
- **选中态 = Focus Blue 描边**（`outline: 2px --accent-focus`，不占布局）；筛选片选中换 `--cta` 填充。
- **字重阶梯 300/400/600/700，500 缺席**；标题 600 + 负字距（h2 21px/600/+0.231px，卡片标题 -0.224px）；正文 17px / 1.47 / -0.374px（文档栏同此，行高比 swiss 紧，是 Apple 的阅读节奏）。

## 6. 跨主题不变量

以下在任何皮肤（含未来新增）下**必须成立**，违反即评审阻断：

1. **语义色不漂移**：错误/失败/高危恒 `--danger` 红系；品牌强调恒 `--accent`；成功恒 `--ok`。severity high 徽章在 Apple 皮肤下仍是红色（spec 明文场景）。
2. **对比度达标**：正文（`--ink`、`--ink70`、`--ink50`）对 paper/paper2/card ≥ 4.5:1；图形与强调（accent/danger/ochre/gray/类别色/调色板/on-\*）对所在底 ≥ 3:1。以 `node scripts/contrast-check.mjs` 为准绳，exit 1 即不过。**用户自选色（类别色/调色色）作底承载文字时，必须经 `lib/contrast.ts` 的 `onColorText()` 钳制**（白/固定深墨 `--ink-fixed` 取对比更优者；静态组合由脚本门禁，动态组合由该函数门禁）。
3. **键盘可达**：所有可点元素可 Tab 到；焦点环 2px `--accent-focus` + 2px offset（`focus-visible`；swiss 下该令牌为墨色，与 `--danger` 错误红明确区分）；hover 才浮现的操作必须 `focus-within` 同显；运行状态用 `aria-live` 播报。
4. **状态完备**：交互件齐备 default / hover / focus-visible / active / disabled（有异步的加 loading、有校验的加 error）。
5. **布局与密度不变**：皮肤不改变三页信息架构、双栏结构、双栏独立滚动、字号的信息层级（哪个字最大在两个皮肤下一致——Apple 的排版覆盖只改「腔调」不改变层级）。
6. **正文行宽**：文档栏锁 `max-width: 720px` 中栏（中文约 40 字/行的舒适区间），不随窗口拉伸。
7. **z-index 语义阶（令牌化）**：`tokens.css` 定义 `--z-float` 40（撤销悬浮条）< `--z-pop` 60（弹层/菜单/颜色选择器）< `--z-onboard` 100（引导层）。侧栏折叠态是 44px 文档流图标栏，不占堆叠层级；toast 系统已移除（通知由撤销浮条承担），`--z-toasts` 出册。新层级必须入阶并回填本节，禁止字面值与 999/9999。
8. **类别色机制**：内置类别色与调色板以主题相对令牌定义，随皮肤自动变；用户显式固定的自定义色值原样保留（不迁移）。

## 7. 动效规范

跨主题共享（曲线令牌在 tokens.css，皮肤不换动效性格）：

- **曲线**：一律 ease-out 家族（`--ease-out-quint` / `--ease-out-expo`）。禁 bounce、禁 elastic。
- **时长三档**（product 节奏，用户在任务中，不等编舞）：
  - 反馈类（hover、按压、勾选）~100–150ms；
  - 状态与到场（页签切换、卡片入场、弹层、横幅）180–250ms；
  - 循环动画只允许「运行中」语义（呼吸脉冲 1.5s），其余禁循环。
- **只动 transform / opacity**（辅以颜色过渡）；禁 animate 布局属性。
- **错峰入场封顶**：列表入场延迟 `min(var(--i), 12) * 35ms`（≈0.42s 封顶），防止长列表等待。
- **入场是增强不是门槛**：内容默认可见，动画不得成为可见性前提（隐藏标签页/无头渲染下动画不触发，内容必须在场）。
- **reduced-motion 不是可选**：全局兜底已有（`prefers-reduced-motion: reduce` 下全部动效即时完成），新增 keyframes 自动被覆盖，但**不得**绕过它写内联动画或 JS 驱动的循环。

## 8. Do / Don't

### Do

- **Do** 新组件从既有方言里找语法：容器抄 `.card` / `.model-row`，操作抄 `button.primary/mini`，标签抄 `.microlabel`，数据抄 `--mono` 用法。
- **Do** 用透明度阶梯（ink70/50/35/15）表达层级，用边框宽度表达结构重量（swiss），用发丝线表达弱分隔（apple）。
- **Do** 选中态用 outline（不占布局、不跳动）；swiss 用 `--accent`，apple 用 `--accent-focus`。
- **Do** 中文为主：界面文案、状态、徽标一律中文；英文只保留 microlabel 级别的栏目小注（如有）。
- **Do** 把「运行中/失败」做成可感知状态（呼吸脉冲、红字、`aria-live`），静默吞状态是事故（见 critique 记录）。
- **Do** 改动颜色后立即跑对比度脚本，四组合全绿再提 PR。

### Don't

- **Don't side-stripe**：`border-left`/`border-right` > 1px 的彩色侧条（卡片、toast、callout）。历史命中 4 处已全部改写（全边框或底色），不许回潮。
- **Don't 渐变文字**（`background-clip: text` + 渐变）；强调用字重不用渐变。
- **Don't 玻璃拟态默认化**：毛玻璃只属于 Apple 皮肤的浮层（`.pop`），swiss 皮肤禁用；任何皮肤不得给卡片/按钮加装饰性 blur。
- **Don't 卡上卡**：嵌套卡片永远是错的；用内部分组（hair 分隔、fsec 标签）替代。
- **Don't 双按钮语法**：同一皮肤内同一动作只允许一种形态；「保存」在两处长得不一样，必有一处是错的。
- **Don't 字号军备竞赛**：实义文本（需要阅读理解的内容）最小 10px；9px 及以下只允许纯装饰性编号。历史上 8.5–9.5px 承载实义已被判为噪点。
- **Don't microlabel 泛滥**：大写宽字距小标签是瑞士皮肤的栏目记号，不是每节都挂的 eyebrow——每个界面限用少数几处。
- **Don't 编号节标记默认化**：01/02/03 序号只用于真实序列（步骤、流程、有序数据列），不做装饰性 scaffold。
- **Don't 混用 accent 与 danger**（§3 双义陷阱）；**Don't** 在组件层写颜色字面量（Token Rule）。
- **Don't 双语混排**：状态徽标、页签、按钮文案保持单一语言（中文），历史残留已清理，不许新增。
- **Don't hover-only 操作**：只 hover 可见的操作键盘摸不到，必须 `focus-within` 同显。

## 9. 评审门禁（合并前过一遍）

自动化门禁（必须通过）：

- [ ] `node scripts/contrast-check.mjs` exit 0（四组合正文 ≥4.5 / 图形强调 ≥3 全绿）
- [ ] `npm test` 相关样式/主题用例通过（`stores/theme.test.ts` 等）

人工目检（按 checklist 逐条）：

- [ ] **全组合遍历**：依次切 swiss/apple × 亮/暗，过一遍导航、工作台、新建审阅、设置、报告、弹层、Toast——无未定义令牌回退、无透明不可读、无上一皮肤残留
- [ ] diff 内**无新颜色字面量**（Token Rule）；新 z-index 进语义阶
- [ ] 新交互件状态齐备（default/hover/focus-visible/active/disabled）且键盘可达
- [ ] 动效在 §7 时长档位内、只动 transform/opacity、reduced-motion 下可接受
- [ ] 禁令扫描：side-stripe / 渐变文字 / 装饰性玻璃 / 卡上卡 / eyebrow 与编号标记泛滥 / 双语混排
- [ ] 错误/失败/高危路径在**目标皮肤**下目检过（不只看默认皮肤）

工具辅助（可选）：`impeccable` 的 detect/hooks 可在 UI 文件编辑后自动扫描部分禁令族；`.impeccable/critique/` 存有历史评审记录，改动三栏布局/新 UI 前先读最近一份。

## 10. 新主题接入契约

未来集成新风格（记为 `X`）时，按序完成以下条目，缺一不可：

1. **语言先于取值**：为 X 写一段外部依据（语言分析文档放 `design/`，形如 Apple-design-analysis.md 之于 apple），先在本文 §4/§5 平级新增该风格的语言规范小节（一句话性格 + 核心词汇 + 取值依据链接），再动代码。
2. **令牌层**：`tokens.css` 新增 `[data-theme="X-light"]` 与 `[data-theme="X-dark"]` **两个全量块**——亮暗都必须完整定义（禁止只做亮色）；颜色全量 + 形状轴定值 + 字体栈；类别色 `--c-*` 7 个与调色板 `--p1…p10` 全部重调（暗面整体提亮，禁沿用亮色值）。文件头注释同步登记该风格的取值依据。
3. **解析层**：`src/domain/types.ts` 的 `ThemeStyle` 联合加 `"X"`；`resolveTheme()` 无需改动（自动合成 `X-light`/`X-dark`）；`colorSchemeOf` 同样自动生效。
4. **选择层**：`SettingsPage.vue` 主题选择器加项；`settings.ts` 默认值不动（swiss + system）。
5. **形态覆盖层**：仅当差异超出令牌可表达范围（如 apple 的黑导航/分段控件/毛玻璃）才在 `base.css` 追加 `[data-theme^="X"]` 覆盖层段落，带注释头说明每段取值依据；基础层保持纯 swiss。
6. **门禁**：跑对比度脚本（自动发现新块，缺令牌直接报错）至全绿；按 §9 做全组合（此时为六组合）遍历目检。
7. **语义不变量自查**（§6 逐条）：danger 恒红、on-\* 搭配合法、focus 环、动效曲线沿用共享令牌、布局与信息层级与既有皮肤一致。

接入完成后回填：本文 §4/§5 新小节、§6 的 z-index 阶（如有新层级）、`src/styles/README.md` 的组合清单。

## 11. 文件地图

| 关注点 | 去处 |
| --- | --- |
| 令牌取值 | `src/styles/tokens.css`（四组合块 + 注释注明各风格依据） |
| 基础样式 / Apple 覆盖层 | `src/styles/base.css`（末段「Apple 形态层」「动效与交互层」） |
| 主题解析与应用 | `src/lib/theme.ts`（resolveTheme / applyTheme） |
| 系统明暗监听 / 响应式应用 | `src/stores/theme.ts`（matchMedia + watchEffect sync） |
| 偏好持久化 | `src/stores/settings.ts`（ui.theme / ui.appearance） |
| 首帧无闪烁 | `src/main.ts`（mount 前 init + start） |
| 对比度门禁 | `scripts/contrast-check.mjs`（算法复用 `src/lib/contrast.ts`） |
| 行为规格 | `openspec/specs/theme-system/spec.md` |
| 皮肤语言依据 | `design/Apple-design-analysis.md`（apple）；`design/02-产品交互原型.html`（swiss 迁移源） |
| 历史评审记录 | `.impeccable/critique/` |
