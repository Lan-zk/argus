# src/styles/ — design token 与基础样式

主题系统（spec: theme-system）的样式落点，取值迁移自 [`design/02`](../../design/README.md) 交互原型，Apple 皮肤依据根目录 [DESIGN.md](../../DESIGN.md)。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| `tokens.css` | design token：颜色令牌按「主题 × 明暗」四组合（`swiss-light` / `swiss-dark` / `apple-light` / `apple-dark`）各自定值，形状令牌仅随主题轴变化；含内置类别色 `--c-*` 与自定义调色板 `--p1`…`--p10`（spec: category-colors）。`:root` 为 swiss-light（默认），切换由根元素 `data-theme` 驱动 |
| `base.css` | 基础样式：reset、字体、按钮等全局元素，迁移自 design/02 原型 |

## 令牌约定

- 语义拆分：`--accent` 品牌强调（随主题走）、`--danger` 错误/高危（恒红系）、`--cta` 填充式主按钮。
- 组合切换发生在 `document.documentElement` 的 `data-theme` 属性上（见 [`stores/theme.ts`](../stores/README.md) 与 [`lib/theme.ts`](../lib/README.md)）。
- 改动颜色令牌后运行 `node scripts/contrast-check.mjs` 校验对比度（任一硬性项不达标则退出码 1）。
