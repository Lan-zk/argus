# src/pages/ — 页面

应用共三页，由 [`App.vue`](../App.vue) 顶部导航切换（spec: review-ui）。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| `NewReviewPage.vue` | 新建审阅：粘贴文稿（≤ 30 000 字符）、勾选类别、选择模型、开始审阅（立即跳转工作台，进度/失败可见） |
| `WorkspacePage.vue` | 工作台：双栏独立滚动——左侧原文高亮（DocViewer），右侧批注卡片（FindingCard）；类别/严重度筛选；报告入口；单类重跑；重启恢复提示条 |
| `SettingsPage.vue` | 设置：模型配置（预设/自定义、检索模型、测试连接、钥匙串诊断）、类别与 Prompt 编辑、类别配色、主题选择 |

`*.test.ts` 为对应组件测试（vitest + @vue/test-utils）。
