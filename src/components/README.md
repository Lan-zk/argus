# src/components/ — 复用组件

工作台与设置页的展示组件；数据来自 [`stores/`](../stores/README.md)，定位与渲染依赖 [`domain/`](../domain/README.md) 的块结构。

## 文件说明

| 组件 | 职责 |
| --- | --- |
| `DocViewer.vue` | 原文渲染：按块渲染 + **重叠高亮**（多 Finding 覆盖同一段文本）；三种锚形态——句级下划线叠加、行范围整行背景（spec: finding-anchor-spans）、引用锚弱化下划线；点击任一锚联动右侧卡片，不改变原文滚动位置 |
| `FindingCard.vue` | 批注卡片：七要素（类别、严重度、quote、问题说明、修改建议、定位状态、锚点跳转）；行范围主锚显示 Lx–Ly，引用锚列出位置/未定位标注 |
| `ReportView.vue` | 汇总报告：优先问题清单 + 各类别小结，条目可追溯到具体 Finding（含行范围位置标签） |
| `OnboardingLayer.vue` | 首次运行引导层（spec: onboarding-first-run）：与首帧同现、零主界面闪烁 |
| `ImportPreview.vue` | 导入预览确认层（spec: document-import）：来源信息 + 可编辑文本区（提取损耗可手动修正）+ 取消/确认；超 30k 显示长文降级警告并允许继续（MUST NOT 截断） |
| `CategoryColorPicker.vue` | 类别配色选择器（spec: category-colors）：内置类别固定色 + 10 色调色板，低对比度实时提示 |
| `UpdateBanner.vue` | 更新提示横幅（spec: app-updates）：挂 App 外壳顶部（与 storage-banner 同位），available（版本号+说明摘要，可关闭本次运行不再弹出）/下载进度/安装/失败重试各态；强调走 `--accent`，仅失败文案 `--danger` |

`*.test.ts` 为对应组件测试（vitest + @vue/test-utils）。
