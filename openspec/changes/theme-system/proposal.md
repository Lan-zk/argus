# theme-system

## Why

ARGUS 目前只有单一瑞士风格亮色皮肤。样式架构对主题化的准备程度很高——所有颜色集中在 `src/styles/tokens.css` 的 CSS 变量中，`base.css` 与全部 Vue 组件零硬编码色值，连领域层的 7 个类别色都是 `var(--c-*)` 引用——但缺少切换机制与额外的皮肤。用户需要暗色模式与 Apple 风格主题，且明暗与风格应独立选择。

## What Changes

- 引入两个正交偏好：**主题**（swiss / apple）与**外观**（light / dark / system），持久化于 `settings.ui`。
- 运行时将两个偏好解析为单一 `data-theme` 属性（`swiss-light` / `swiss-dark` / `apple-light` / `apple-dark`）；外观为 system 时监听 `prefers-color-scheme` 实时跟随系统切换。
- `tokens.css` 从单一 `:root` 扩展为 4 个显式主题块；新增形状令牌（`--radius`、`--shadow` 等，仅随主题轴变化）。
- 拆分 `--red` 的双重职责为 `--accent`（品牌强调，随主题走：swiss=红、apple=系统蓝）与 `--danger`（错误/高危，恒红），`base.css` 中现有 `--red` 用法逐一分流。
- `base.css` 将散落的硬编码值令牌化（红/墨底上的 `#fff` 文字 → `--on-accent`，`rgba` 阴影 → `--shadow`）。
- 每个主题组合重调 7 个类别色与 3 个严重度色的对比度（深底不能直接照搬米色纸上的取值）。
- Apple 主题为完整质感替换：圆角、柔和阴影、系统蓝强调、SF 字体气质、分段控件形态——不只是换配色。
- 设置页新增「外观」分区：主题选择 + 明暗选择（亮色 / 暗色 / 跟随系统）。
- 类别颜色数据 MUST NOT 改动：领域层 `color: "var(--c-logic)"` 的引用方式使其自动跟随主题。

## Capabilities

### New Capabilities

- `theme-system`: 主题（风格）与外观（明暗）双轴模型、运行时解析与系统跟随、CSS 令牌分层与四组合皮肤定义、`--accent`/`--danger` 语义拆分、设置页切换入口、偏好持久化与启动恢复。

### Modified Capabilities

（无。`app-persistence` 的「界面偏好记忆」为「至少包括分栏宽度」的下界表述，主题偏好属于其自然延伸，无需修改该需求；`settings` 与 `review-ui` 的既有需求不受影响。）

## Impact

- `src/styles/tokens.css` — 重写为 4 个主题块 + 令牌拆分与新增。
- `src/styles/base.css` — 硬编码值令牌化、`--red` 用法分流为 accent/danger、Apple 形态层（圆角/阴影/按钮/控件样式）。
- `src/stores/settings.ts` — `ui.theme` / `ui.appearance` 偏好字段、解析 action、`matchMedia` 监听。
- `src/lib/persistence.ts` — `defaultSettings().ui` 扩展默认值（swiss / system，即现有视觉不变）。
- `src/main.ts` — 启动时尽早挂载 `data-theme`，避免首帧样式闪烁。
- `src/pages/SettingsPage.vue` — 「外观」分区 UI。
- 无新增依赖；领域层（`src/domain/`）、组件模板与业务逻辑零改动。
- 默认值保持现状视觉：swiss + system（系统为亮色时与今天一致；唯一例外——ochre 类别/中严重度色由 `#c08a00` 微调为 `#b38100` 以满足新 spec 的 ≥3:1 对比度，属存量问题修正）。
