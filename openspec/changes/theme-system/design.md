# theme-system — 技术设计

## Context

现状样式架构（见 proposal「Why」）：颜色全部集中在 `src/styles/tokens.css` 的 `:root` 单块（约 20 个颜色令牌 + 7 个类别色 + 字体栈），`src/styles/base.css` 约 227 行规则几乎全部消费 `var(...)`，Vue 组件内联样式零硬编码，领域层 `default-categories.ts` 的类别色是 `var(--c-*)` 字符串。持久化已有 `settings.ui` 对象（`splitPercent`），经 `src/lib/persistence.ts` 的 Tauri store 透明落盘；应用初始化目前发生在 `App.vue` 的 `onMounted`（`settings.init()` 异步读取后挂载状态）。

已知债务：`--red` 同时承担品牌强调与功能色；`base.css` 有 4-5 处 `#fff`（红/墨底上的文字）与 1 处 `rgba` 阴影为硬编码。

## Goals / Non-Goals

**Goals:**

- 两个正交偏好（主题 × 明暗）独立持久化、独立切换、即时生效。
- 四组合皮肤（swiss/apple × light/dark）完整定义，含形状语言层。
- 启动首帧即正确皮肤，无可感知闪烁。
- 现有代码路径最小侵入：领域层、组件模板零改动。

**Non-Goals:**

- 不做用户自定义主题 / 令牌编辑器。
- 不做第三种及以上风格（架构允许多主题，但本次只交付 swiss 与 apple）。
- 不做主题级的布局差异（四组合共享同一 DOM 结构与栅格）。
- 不迁移或改写已保存的类别数据（含用户自定义固定色值）。

## Decisions

### D1：JS 侧合成单属性，不做双属性 CSS 级联

偏好持久化为两个字段 `settings.ui.theme`（`"swiss" | "apple"`）与 `settings.ui.appearance`（`"light" | "dark" | "system"`），但应用到 DOM 时合成**单一**属性：`<html data-theme="swiss-dark">`。

- 备选：挂 `data-style` + `data-mode` 两个属性，CSS 用 `[data-style="apple"][data-mode="dark"]` 级联覆盖。否决原因：apple-dark 需同时压过两边的声明，块书写顺序变成隐式契约，出错时症状是「局部颜色串皮肤」，难排查。
- 单属性下 `tokens.css` 是 4 个平铺块，块间无顺序依赖，可 diff、可目检。
- 解析逻辑收敛为纯函数 `resolveTheme(theme, appearance, systemDark): "swiss-light" | ...`（放 `src/lib/theme.ts`），便于单测。

### D2：解析与应用放 composable，matchMedia 只有一处监听

`src/lib/theme.ts` 导出纯函数；`src/stores/` 新增轻量 `theme` store（或并入现有 settings store 的 getter/action，实施时取更顺手者）：持有 `systemDark` 状态，`watchEffect` 将解析结果写入 `document.documentElement.dataset.theme`，同时设置 CSS `color-scheme`（`light` / `dark`），让滚动条与原生控件跟随明暗。`matchMedia("(prefers-color-scheme: dark)")` 的 `change` 监听全局仅此一处，收到事件只更新 `systemDark`，由响应式链路触发重新应用。

### D3：令牌分两层——颜色按 4 组合、形状按 2 主题

```
tokens.css
├── :root                        颜色+形状的完整默认（= swiss-light，值与现状一致）
├── [data-theme="swiss-dark"]    颜色重调（形状继承 :root）
├── [data-theme="apple-light"]   颜色重调 + 形状令牌覆盖
└── [data-theme="apple-dark"]    颜色重调 + 形状令牌覆盖
```

- 颜色令牌：`--paper --paper2 --card --ink* --accent --danger --ochre --gray --on-accent --shadow --c-*`（7 类别色）。每个组合各自定值，明暗间不共享。
- 形状令牌：`--radius --radius-sm --shadow-pop` 等，只在 apple 块覆盖；swiss 保持直角硬影。
- 语义拆分：现 `--red` 的全部用法分流——品牌强调与交互态（logo 方块、tab 选中条、`.primary:hover`、`::selection`、焦点环、选中/hover 轮廓、`.divider:hover` 拖拽交互、`.restore-banner` 信息通知条、编号类排版红字等）→ `--accent`；错误/高危/失败（`.errbox`、`.sev.high`、`.badge.failed`、`.rp-failbanner`、`.unb`、`.charcount.over`、`.test-line.bad`、`.toast.red` 等）→ `--danger`。swiss 皮肤两者同为现在的红 `#e2231a`（视觉零变化），apple 皮肤 accent 为系统蓝、danger 保持红系。实施时 `.divider:hover` 与 `.restore-banner` 归入 accent（交互强调/信息通知，非错误），较初版清单修订。
- 硬编码清理：`#fff`（`::selection`、`.sev.high`、`.restore-banner`、`.toast`）→ `--on-accent` / `--on-danger`；`.pop` 的 `rgba(23,21,15,.15)` → `--shadow-pop`。
- 字体栈：apple 块 `--sans` 以 `-apple-system, "SF Pro Text"` 开头；`--mono` 现已 SF Mono 开头，不动。

### D4：Apple 形态层用属性前缀选择器覆写表皮

`base.css` 中的按钮、输入框、徽章、卡片、弹层等控件样式，在 `[data-theme^="apple"]` 作用下覆写为圆角、柔和阴影、细边框、系统蓝焦点环、分段控件形态的 tab 等。只改 `base.css` 的样式规则，不改组件 DOM/类名。形态覆写与令牌块同文件分层书写，规则名不变、按选择器前缀区分，避免组件感知主题。

### D5：初始化前移到 mount 之前，首帧即目标皮肤

现状 `settings.init()` 在 `App.vue onMounted` 里异步执行——若沿用，`data-theme` 会在首帧后才写入，暗色用户会看到亮色闪一下。调整 `main.ts`：`createApp` 之前 `await loadState()`，把 `ui.theme/ui.appearance` 交给主题应用逻辑写入 `data-theme` 后再 `mount`。Tauri 本地 store 读取为毫秒级，不构成可感知的启动延迟。`App.vue` 的 `onMounted` 保留其余初始化（session 恢复等），仅消费已加载的状态。

### D6：暗色与类别色调色原则

- 暗底不用纯黑：`--paper` 取深灰阶（约 `#16161a` 一带），`--card` 略浅于 `--paper`，层级靠明度差不靠阴影。
- 7 个类别色在暗色下整体提亮、适度降饱和，保证在深底上 ≥3:1 且七色互相可分；具体色值在实施时用对比度脚本校验定稿（不阻塞架构）。
- 严重度色同步重调：high 恒红系（暗色下取亮红）、medium/low 相应调整。

## Risks / Trade-offs

- [风险] `base.css` 中 `--red`/硬编码用法分流有遗漏，某元素在 apple 皮肤下串色 → 缓解：实施时先 `grep` 全量清点 `--red` 用法逐条归类；spec 已含「四组合逐界面目检」场景。
- [风险] 暗色类别色/文本对比度不达标 → 缓解：写一次性对比度校验脚本（对令牌组合计算 WCAG 比值）纳入任务，不靠目测。
- [风险] 自定义类别的用户固定 hex 色在暗色下对比不足 → 接受（spec 已声明原样保留），不做运行时改色。
- [风险] 初始化前移改变启动时序，影响现有恢复逻辑 → 缓解：`loadState` 仅读取提前，session 恢复仍在 `App.vue`，顺序语义不变；跑现有测试 + 手工验证恢复提示条。
- [取舍] 4 个令牌块存在重复（如 apple 两明暗的形状令牌相同）→ 接受：平铺可比性优先于去重；若未来主题增多再考虑按轴拆分文件。

## Migration Plan

- 无数据迁移：`settings.ui` 旧数据缺 `theme/appearance` 字段时按默认值（swiss / system）处理，`loadState` 合并默认值即可。
- 回滚：整体 revert 即可，无持久化格式变更。
- 默认值保证视觉零变化：swiss + system（亮色系统下）的渲染结果与现状逐像素一致（`--accent = --danger = #e2231a`）。实施期唯一例外：ochre（`--ochre`/`--c-argument`）由 `#c08a00` 微调为 `#b38100`——存量取值在纸底上仅 2.75:1，不满足本 spec 的 ≥3:1，对比度脚本驱动修正。

## Open Questions

- 四组合的最终色值（尤其暗色下的 7 类别色与 apple 蓝的具体色号）——不改变架构与任务结构，实施期用对比度脚本辅助定稿。
