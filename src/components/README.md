# src/components/ — 复用组件

工作台与设置页的展示组件；数据来自 [`stores/`](../stores/README.md)，定位与渲染依赖 [`domain/`](../domain/README.md) 的块结构。

## 文件说明

| 组件 | 职责 |
| --- | --- |
| `DocViewer.vue` | 原文渲染：按块渲染 + **重叠高亮**（多 Finding 覆盖同一段文本）；点击高亮联动右侧卡片，不改变原文滚动位置 |
| `FindingCard.vue` | 批注卡片：七要素（类别、严重度、quote、问题说明、修改建议、定位状态、锚点跳转） |
| `ReportView.vue` | 汇总报告：优先问题清单 + 各类别小结，条目可追溯到具体 Finding |
| `OnboardingLayer.vue` | 首次运行引导层（spec: onboarding-first-run）：与首帧同现、零主界面闪烁 |
| `CategoryColorPicker.vue` | 类别配色选择器（spec: category-colors）：内置类别固定色 + 10 色调色板，低对比度实时提示 |

`*.test.ts` 为对应组件测试（vitest + @vue/test-utils）。
