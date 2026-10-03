# category-colors

## Why

用户可以新建自定义 Review Category，但颜色恒为兜底灰（`addCategory` 写死 `var(--gray)`），没有任何配置入口 —— 多个自定义类别在工作台高亮、Finding 卡片、报告中无法互相区分，类别色的「并行辨识」价值对自定义类别完全缺失。数据链路（`ReviewCategory.color` 字段、`updateCategory` patch、全部下游消费方）早已就绪，缺的只是选择入口与一组随主题成对的颜色资产。

## What Changes

- 设置页类别的颜色方块变为可点入口，弹出颜色选择弹层。
- 选择弹层提供两条路径（方案 C）：
  - **策展调色板**：≥8 个预设色，以 `--p1..--pN` 令牌实现，四组合皮肤各自提供明暗成对取值（与内置 7 类同机制），对比度纳入 `contrast-check.mjs` 校验；
  - **自定义取色**：原生色板输入任意 hex；选择时对当前主题的纸/卡底色做 ≥3:1 实时校验，不达标显示 ⚠ 提示（不阻断保存，固定色值原样保留、不随明暗变化）。
- 新建类别的兜底色从恒定灰改为**按调色板轮转**，多个新类别即刻可区分。
- 复制类别沿用现有逻辑（自动带上颜色），不做额外改动。
- 调色板取色避开与内置 7 类同 hue 的值，防止自定义类与内置类撞色。

## Capabilities

### New Capabilities

（无。）

### Modified Capabilities

- `settings`: 「Review Category 管理」需求增加类别颜色配置行为 —— 色板选择（随主题）、自定义色值（固定 + 低对比提示）、新建默认色轮转，及对应场景。
- `theme-system`: 新增「自定义类别调色板」需求 —— 系统提供随主题成对的类别调色板令牌，每个皮肤组合下与底色 ≥3:1、与内置类别色可区分；自定义固定色值继续原样保留（与既有「类别色随主题自动跟随」需求衔接）。

## Impact

- `src/styles/tokens.css` — 四主题块各新增 ≥8 个 `--p*` 调色板令牌（值由对比度脚本校验定稿）。
- `scripts/contrast-check.mjs` — 扩展校验 `--p*` 对纸/卡底 ≥3:1。
- `src/components/CategoryColorPicker.vue`（新增）— 颜色选择弹层（复用 `.pop` 毛玻璃样式与入场动效）。
- `src/pages/SettingsPage.vue` — csr-top 色块改为触发入口并接入弹层。
- `src/stores/settings.ts` — `addCategory` 兜底色改为调色板轮转。
- `src/domain/types.ts` — 无改动（`color?: string` 已兼容 `var()` 引用与 hex）。
- 无数据迁移：既有类别的 `var(--gray)` 兜底值继续有效；未配置颜色的旧自定义类别不强制变色。
