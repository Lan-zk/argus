# Argus 前端 UI 评审记录 — 2026-10-06（oil-ui「给已有界面评审」协议）

- 评审对象：当前工作区（未提交改动后的）前端 UI，dev server `http://localhost:1420`（纯浏览器模式，持久化走内存兜底）。
- 评审标准：项目自己的成文规范（`design/DESIGN-GUIDE.md` + `src/styles/tokens.css`），不是评审者个人理想风格。
- 方法：真实 UI 链路驱动（本地 CORS mock OpenAI 端点 :8932 → 引导层配置模型 → 粘贴样文 → 跑完六类审阅 → 工作台/报告/失败态逐状态截图）；四皮肤组合、200% DPR、宽窗口、动效三帧；隔离评审者只看截图与规范摘要，不看源码与制作过程。
- 证据：本目录 `shots/`（23 张 PNG + 动效三帧 JPG）。取证工具：`drive.mjs`（自研 CDP 驱动；shoot.mjs 的合成鼠标点击在本应用 div/span @click 上不可靠，详见文末附注）。

## 一、代码层规范符合性（主 Agent 扫描，评审前完成）

### 违规 / 偏差（按影响排序）

1. **`--ink35` 承载文本** — `src/styles/base.css:116` `.docpane .divider-hint{font-size:9px;color:var(--ink35)}`
   违反 §3「ink35 只做边框与发丝、禁承载文本」，同时命中 §8 字号底线（实义文本 ≥10px；"DOC · 只读"是状态提示不是装饰编号）。建议：提到 10px 并换 `--ink50`。
2. **z-index 字面量未入阶** — `src/components/ImportPreview.vue:55` `z-index: 90`
   违反 §6.7 语义阶（40/60/100）。导入预览是弹层，应 `var(--z-pop)`（60）；若有意压在引导层之下需回填 §6.7。
3. **预置数据错误（界面可见）** — `src/domain/presets.ts:36`
   `qwen-token-plan-individual`（阿里 Qwen · 个人版）推荐模型是 `glm-5.2`（智谱 GLM）。配置引导卡片直接把该值展示给用户，属内容错误。
4. **Token Rule 字面量（字母级）**
   - `src/styles/base.css:299` 与 `src/App.vue:215`：`color-mix(in srgb, var(--cta) 88%, #000)` —— `#000` 字面量在令牌层之外。建议提为令牌（如 `--cta-hover`）。
   - `src/App.vue:207`：撤销浮条 Apple 阴影 `0 10px 30px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.08)`，与设计文档 D4 规定且 `.pop` 实际使用的系统菜单影 `0 6px 18px rgba(0,0,0,.14), 0 1px 3px rgba(0,0,0,.08)`（base.css:342）不一致 —— 同族浮层两套影子值，建议统一。
   - `src/components/ImportPreview.vue:65`：`rgb(from var(--ink) r g b / 25%)` —— 令牌派生相对色，功能合规；建议规范补一句豁免口径。
5. **9px 英文小注的灰色地带** — `base.css:81/260`（`.catrow .en` / `.csr-top .en`）
   §8 说 9px 只许纯装饰性编号，但 §8 Do 又允许「英文 microlabel 级栏目小注」。类别英文注记（LOGIC 等）横跨两条规定。建议：统一提到 10px，或在规范中为英文小注明确豁免。
6. **动效曲线字母偏差** — `base.css` `.errbox{animation:shake .3s linear}`；§7 说曲线一律 ease-out 家族。摇头用 linear 有交互合理性，建议规范注明豁免或改 ease-out。

### 通过项

- `node scripts/contrast-check.mjs` 四组合全绿（正文 ≥4.5 / 图形 ≥3）。
- 禁令扫描未命中：side-stripe、渐变文字、装饰性玻璃（毛玻璃仅 apple 浮层三处：`.pop`/`.ccp`/撤销浮条，合规）、嵌套卡片、双语混排。
- 动效 §7 合规：时长三档、只动 transform/opacity、错峰入场封顶 12×35ms、`prefers-reduced-motion` 兜底、循环动画仅「运行中」呼吸脉冲。
- border-radius 字面量：0 值与 App.vue 14px（D4 文档规定值）均合规。
- CategoryColorPicker `#888888` 为文档记录的白名单例外。
- 键盘可达：菜单项/chip 虽是 div/span，但 Enter/Space 处理与 aria 属性齐全（代码层核查）。

## 二、隔离评审者结论（无历史上下文，只看截图+规范）

评审者基于 12 次图像分析 + 同组交叉复核，输出 7 条偏离规范、3 条完成度问题、4 条可删文字、8 条细节瑕疵。以下为主 Agent **逐条对照源码核实后的裁决**（评审者原文全文见本节末尾附录）。

### 采纳（代码/证据可证）

| # | 问题 | 位置 | 核实结果 |
| --- | --- | --- | --- |
| A1 | **报告页签英文标题「Category Summary」「完整 Findings」** | `ReportView.vue:65,92` | 实锤，命中「禁双语混排」（评审者报的位置不对，方向对） |
| A2 | **引导层用 microlabel 样式承载中文实义字段标签**（显示名称/Base URL/API Key/Model 共 9 处），且与设置页的 `.flabel` 字段标签方言不一致 | `OnboardingLayer.vue` vs `SettingsPage.vue` | 实锤；规范明文 microlabel「不承载实义信息」 |
| A3 | 类别行中英并列 + 英文小注 9px | `base.css:81/260` | 与代码扫描 #5 合并：判断项，建议统一 10px 或删英文 |
| A4 | Kimi 同名双卡辨识负担；Qwen 个人版推荐 `glm-5.2` 数据错配 | `presets.ts:28-29,36` | 两个独立来源同判（评审者 + 代码扫描） |
| A5 | 主动作与决策区割裂：开始审阅按钮钉在左栏底部，右栏勾选完成后需视线逆行；按钮不反馈已选数 | `NewReviewPage.vue`（`.new-actions` sticky） | 成立；低成本方案：按钮文案动态化「开始审阅 · 6 类」 |
| A6 | 报告渲染在右侧窄栏内，阅读态正文宽度受分栏比例挤压 | `WorkspacePage.vue` sidepane | 调整后成立（评审者描述的三栏机制有误，但"报告需要更宽版面"值得决策） |
| A7 | 计数未用等宽（「已选 6 / 6」「共 N 个」） | NewReviewPage/OnboardingLayer | 小 nit，规范「计数用 mono」口径支持 |
| A8 | 服务商网格 auto-fill 不分组断行出现孤行卡 | onboarding `.ob-grid` | 小 nit |
| A9 | 侧栏空态第二行「点上方…」引导文案冗余 | `ProjectsSidebar.vue` | 小 nit（字符串代码确认） |

### 否决（代码反证或读数幻觉）

- **卡片圆角 9–14px**：代码 `border-radius: var(--radius)`，apple 皮肤令牌即 18px——视觉工具测距不可靠。
- **「18 findings」计数**：源码无此字符串；真问题是 A1 的报告标题。
- **总评被压在批注列表底部**：`总体摘要`（R.1）在报告页签顶部。
- **「审阅配置 A」卡（API 端点/密钥已配置四行）**：NewReviewPage 无此组件，读数幻觉。
- **「引文」9.5px 表头**：实际是 `.quote::before`「原文」10px，达字号底线。
- **暗面高亮文字对比吃力**：高亮为多层下划线方案，文字恒 `--ink`，不存在文字压色问题。
- **失败态残留进度描边**：19 号证据六类全失败，无"成功行"。

### 规范层讨论项（协议要求单独列出，交用户决定）

- **焦点环红与错误红同谱**（评审者 D6）：swiss 焦点环 `--accent-focus`（§6.3 规范自身规定）与错误 `--danger` 同为红系——"焦点在这里"与"这里错了"仅靠 2px offset 区分。这是规范级张力，不是实现偏差。
- **红的量感**（评审者 D5）：编号红、mono 计数红是规范明文允许的用法；但工作台同屏红角色确实多（编号/页签/计数/勾选/描边）。品味判断，交用户。

### 动效与记忆点

- 三帧证据显示"结构不动、内容生长"的同构手感，与产品性格一致；缓动曲线/时长静帧不可判（**未评审**）。
- 评审者判断：编辑部"工作面"成立（原文为轴、批注成列、六类六色收官），但**完成时刻尚未做成记忆点**——建议批注按类别色逐条落位、结论卡最后压轴（180–250ms 状态档预算内可完成）。

### 附录：评审者原文（未删改）

> 拍摄元数据无异常。偏离规范：D1 apple 批注卡圆角 9–14px（否决：代码为 var(--radius)=18px）；D2 类别名中英并列命中双语混排（部分采纳→A3）；D3 「18 findings」英文计数（否决读数，但定位到真问题→A1）；D4 页签与栏标题同义不同词（弱采纳，低优先级文案一致性）；D5 swiss 红 accent 角色蔓延（→规范层讨论）；D6 红色输入框描边与错误红无从区分（→规范层讨论；注：截图中 textarea 红框是取证脚本 focus 所致的焦点环）；D7 microlabel 越界用于实义表单标签（采纳→A2）。
> 完成度三处：P1 主动作距离（采纳→A5）；P2 完成态总评不可及（否决）；P3 报告正文被挤压（调整采纳→A6）。
> 可删文字：T1 侧栏空态第二行（采纳→A9）；T2 审阅配置卡四行（否决，幻觉）；T3 报告页脚统计行（否决，未找到）；T4 完成徽标重复（否决，文案读数有误，实际为「已完成」单处）。
> 细节：J1 引文 9.5px（否决，实际 10px 达标）；J2 引导标题行基线错位约 3px（未验证，低置信）；J3 网格孤行卡（采纳→A8）；J4 计数未等宽（采纳→A7）；J5 暗面高亮对比（否决）；J6 失败态残留描边（否决）；J7 错误文案系统视角（弱采纳：文案实际为「部分失败」+ 分类错误行，信息已足够，措辞可再口语化）；J8 卡片内边距紧（否决测距，代码 12/14px 为既定值）。
> 两问：a) 有让人记住的"工作面"，还没有让人记住的"一刻"，建议把完成瞬间做成记忆点；b) 动效三帧同一手感（结构不动、内容生长），曲线与时长未评审。

## 三、主 Agent 取证过程中的观察（补充）

- 首启默认 appearance=system：在深色系统的机器上首帧即 swiss-dark，符合设计（§2 首帧无闪烁路径）。
- 引导层服务商网格中「Kimi」两张同名卡（国际端点/国内端点，仅小字 region 区分）在 5 列网格里观感近似重复；是否合并或标题带端点后缀，交产品决定（数据本身有区分，不算错误）。
- 工作台 `.ws-actions` 类名同时用在头部操作区和状态栏操作区（`WorkspacePage.vue`），选择器语义易混（本次取证即被绊到）；建议状态栏改用独立类名。

## 四、验收建议（不改代码，交用户决定优先级）

按影响排序（合并代码扫描 + 评审者采纳项）：

1. **presets 数据错误**：Qwen 个人版推荐 `glm-5.2`（内容错误，用户可见）；顺带决定 Kimi 双卡是否后缀化（Kimi·国际 / Kimi·国内）。
2. **ReportView 英文标题**：「Category Summary」「完整 Findings」改中文（双语混排禁令）。
3. **divider-hint 的 ink35+9px**（base.css:116，两行改动）。
4. **引导层字段标签方言**：microlabel→正文字号标签，与设置页 .flabel 统一。
5. **ImportPreview z-index 90 入阶**（→ var(--z-pop)）。
6. **统一撤销浮条与 .pop 的 Apple 阴影值**；`#000` 提令牌。
7. **完成时刻记忆点**（评审者建议：批注按类别色逐条落位、结论卡压轴，动效档内可做）。
8. **开始审阅按钮计数反馈**（「开始审阅 · 6 类」）。
9. 低成本 nit 清单：计数改等宽、网格分组断行、空态第二行删减、9px 英文小注定调（提 10px 或规范豁免）、报告页签是否给更宽版面（布局级决策）。
10. 规范层讨论：swiss 焦点环与错误红同谱的区分度（§6.3 自身规定，改规范或加区分手段）。

## 五、处理结果（2026-10-06 同日实施，用户授权三批全做）

### 已改（含验证）

| 批 | 改动 | 文件 | 验证 |
| --- | --- | --- | --- |
| 1 | Qwen 个人版推荐模型 `glm-5.2` → `qwen3.8-max` | `src/domain/presets.ts:36` | 测试通过；取值与同服务另两卡一致（个人版真实模型名如与线上目录不符可再调） |
| 1 | 报告标题「Category Summary」→「分类小结」、「完整 Findings」→「全部批注」 | `ReportView.vue` | 截图 07 复核 ✓ |
| 1 | divider-hint 9px/ink35 → 10px/ink50 | `base.css` | 对比度门禁 ✓（ink50 ≥4.5） |
| 1 | ImportPreview `z-index:90` → `var(--z-pop)` | `ImportPreview.vue` | 入语义阶 |
| 1 | 新令牌 `--cta-hover`（四皮肤块，`--cta` 88% 混墨）；撤销浮条阴影对齐 D4 文档值（`0 6px 18px …`） | `tokens.css`、`base.css`、`App.vue` | Token Rule 字面量出清（组件层不再出现 `#000`） |
| 2 | 引导层 6 处字段标签 microlabel→flabel（视觉本已等价，属类名语义清理）；custom 表单「Model」→「模型」 | `OnboardingLayer.vue` | 截图 03 复核 ✓ |
| 2 | 「开始审阅 · N 类」动态计数（数字等宽） | `NewReviewPage.vue`、`base.css` | 截图 04 复核 ✓ |
| 2 | 「已选 n / n」计数等宽；引导层「共 N 个」等宽 | `NewReviewPage.vue`、`OnboardingLayer.vue` | — |
| 2 | 侧栏空态第二行删除（含死 CSS） | `ProjectsSidebar.vue` | 测试通过 |
| 2 | Kimi/智谱/MiniMax/阿里/小米同名卡消歧：卡片标题统一走 `displayProviderName`（名称+region），删除独立 region 小字 | `OnboardingLayer.vue`、`SettingsPage.vue` | 截图 01 复核：「Kimi（国际端点）/Kimi（国内端点）」；`presets.test.ts` 原断言保绿 |
| 3 | 类别英文小注 9px→10px（`catrow/csr-top .en`） | `base.css` | 字号底线达标 |
| 3 | **swiss 焦点环改墨色**：`--accent-focus` swiss 亮 `#17150f`/暗 `#ece9e2`（apple 保持 Focus Blue）；`.hl.ref.sel` 选中锚改 `--accent`（与选中卡红描边联动，apple 覆盖层保持 Sky） | `tokens.css`、`base.css` | 截图 04 复核：焦点环近黑；对比度门禁 ✓ |
| 3 | 报告页签 = 阅读态：文档栏临时 32%（不落盘，切回即恢复），分隔条禁用提示；`.report` 限宽 720px 居中 | `WorkspacePage.vue`、`base.css` | 截图 07 复核：文档栏 32%/报告 68%，标题中文 ✓ |
| 3 | 完成时刻记忆点：runstrip 完成格一次性沉降（复用 settle，250ms ease-out） | `base.css` | 与徽章 settle、页签 report-ready 闪色、卡片错峰入场构成收束时刻 |
| 3 | 文档同步：DESIGN-GUIDE §3 令牌表/§6.3、tokens.css 头注释、DESIGN.md 快照（Focus 行 + `--cta-hover`）、design.json 边车（hover 令牌化） | 四个文档 | 手工定点刷新（未走全量 document 重访——仅两处令牌增量，定性语言原样保留） |

### 验证记录

- `npm test`：40 文件 / 358 用例全绿（中途 presets 改名触发 1 处断言失败，改为展示层统一方言后恢复）。
- `npx vue-tsc --noEmit`：exit 0。
- `node scripts/contrast-check.mjs`：四组合全绿。
- 前后对比取证：`shots/`（基线 23 张）vs `shots-after/`（改后 23 张 + 动效三帧），关键差异经图像复核确认（报告 32/68 版面、按钮计数、Kimi 消歧、墨色焦点环）。

### 未做与说明

- 报告页签宽版面用的是「收窄文档栏」方案（页签内状态、不动信息架构）；若要报告独立全宽版面属布局架构改动，留待后续决策。
- presets 个人版推荐模型取 `qwen3.8-max` 是与同族卡片一致性的选择，线上个人版实际可用模型如不同请微调。
- 评审者 D5「红的量感」未做处理：编号红/计数红为规范明文允许，属品味判断，保持现状。
- 完成时刻动效为增强（reduced-motion 全局兜底自动覆盖）。

## 六、runstrip 单组件打磨（2026-10-06 续，oil-ui 组件级五步）

设计说明见 `runstrip-设计说明.md`；证据在 `shots-runstrip/`（修正后版本）。

### 设计：类别墨线
每格底部 3px 类别色线为状态主视觉：等待=12% 虚位轨道（色块减淡）；运行中=22% 轨道 + 30% 色段循环滑行（活字排版隐喻）；完成=墨线从左压满（scaleX stamp 250ms）；失败=红虚线断线。六镜头全完成后六色连成一条——「六镜头各留一线」的收束记忆点。错误文字单行省略（title 全文）。

### 独立评审（10 分制，一轮）
评分 **5/10**，像素级实测抓到核心硬伤：**六格在默认视口换行（flex + min-width 172px×6 超内容宽），"六色连线"不存在**——5+1 换行且第六格被拉伸满宽、右缘通栏出血与状态栏 28px 内缩不对齐；失败虚线相邻格错位（同为换行所致）；等待态记号过弱；「完成」×6 与状态栏「类别进度 6/6」三重冗余；错误文案"Base URL"开发者黑话；论证金色权重轻（3.13:1）。滑行动效当时零帧捕获（后经延迟取证证实存在）。

### 修正（逐条采纳或说明）
| 反馈 | 处理 |
| --- | --- |
| 六格换行/连线不成立 | `.runstrip` 改 `grid: repeat(auto-fit, minmax(150px,1fr))`，默认视口六格同行；窄窗自动降列。截图复核：六色带成立 |
| 右缘出血/与状态栏不对齐 | `margin:0 28px` 对齐状态栏文本列 |
| 等待态无记号 | 新增 12% 虚位轨道（"墨线虚位"语义），四态一眼可读 |
| 失败虚线错位 | 随 grid 同行等高自然对齐；虚线恒 `--danger` 实色（此前读数偏淡为抗锯齿+换行叠加） |
| 状态栏「类别进度」冗余 | 删除（含 runProgress 死代码）；「完成 · N」保留——四态文案语法一致性与屏幕阅读器可读性优先（部分采纳） |
| "Base URL"黑话 | 改「无法连接模型服务。请检查网络，或到 设置 → Models 核对该模型的服务地址（Base URL…）」——首句人话，技术细节留在后半句 |
| 论证金权重轻 | swiss-light `--c-argument` #b38100→#93690a，对比度 3.13→4.44:1 |

### 验证
- `npm test` 40 文件 359 用例全绿；`vue-tsc` 0 错误；contrast-check 全绿（argument 色提升）。
- 修正后取证：六格一行+六色带（图像复核 ✓）、运行中帧实证「浅轨道+深滑段」（延迟级联取证 ✓）、失败态对齐断线 ✓。
- 动效证据：`rs-cascade-*.jpg` 四帧（600ms 递增延迟的真实级联：满墨逐格落定）。

### 未验证项（如实记录）
- 落墨 scaleX 方向性（从左压满）静帧仍不可判——级联帧只见浓度递增，方向性需录屏逐帧放大核验。
- 极窄窗口（<900px 内容宽）下六格降为 4-5 列的观感未取证（桌面应用场景下罕见）。

## 附注：取证工具链

- `mock-cors.mjs`：项目 mock 的 CORS 版（预检需回显 `access-control-request-headers`，OpenAI SDK 带 `x-stainless-*` 头，写死白名单会被预检拒绝）。
- `drive.mjs` / `finish.mjs`：CDP 驱动（DOM 级 `.click()` + v-model input 事件 + `Emulation.setEmulatedMedia` 控明暗 + `setDeviceMetricsOverride` 控视口/DPR + screencast 三帧）。shoot.mjs 在本应用上的失败点：合成鼠标 press→release 间隔内，账户菜单被 document 级 click-outside 监听关闭、卡片 v-if 切换导致 click 落空；属工具与合成事件的交互问题，非产品缺陷。
- `diag.mjs`/`fetch-probe.mjs`：诊断脚本（可留作复跑，也可删）。
