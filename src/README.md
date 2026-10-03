# src/ — 前端源代码

Vue 3 + TypeScript 前端，经 Vite 构建，在 Tauri WebView 中运行（纯浏览器 `npm run dev` 也可调试，持久化与钥匙串走内存兜底）。

## 目录结构

| 子目录 | 职责 |
| --- | --- |
| [`domain/`](./domain/README.md) | 纯函数领域核心（无框架依赖）：文稿解析、三信号定位、规范化、去重、Prompt 组装、错误分类 |
| [`ai/`](./ai/README.md) | `@earendil-works/pi-ai` 封装：provider 工厂、结构化输出工具、自动修复、重试、测试连接、长文降级 |
| [`orchestrator/`](./orchestrator/README.md) | 审阅编排：并发池、会话状态机、单类重跑、报告生成 |
| [`stores/`](./stores/README.md) | Pinia 状态：settings / session / ui / theme / onboarding |
| [`pages/`](./pages/README.md) | 三个页面：NewReview（新建审阅）/ Workspace（工作台）/ Settings（设置） |
| [`components/`](./components/README.md) | 复用组件：DocViewer、FindingCard、ReportView、OnboardingLayer、CategoryColorPicker |
| [`lib/`](./lib/README.md) | 基础设施：Tauri 环境与 fetch 通道、钥匙串封装、持久化、主题应用、对比度计算 |
| [`styles/`](./styles/README.md) | design token 与基础样式（主题 × 明暗四组合） |
| `assets/` | 构建期静态资源（脚手架残留的 vue.svg） |

## 顶层文件

- `main.ts` — 应用入口：安装 Tauri fetch 通道 → 初始化 Pinia → 恢复主题偏好（首帧防闪烁）→ mount。
- `App.vue` — 应用外壳：顶部导航 + 三页切换 + 首次运行引导层 + 重启恢复。
- `App.test.ts`、`vite-env.d.ts` — 外壳测试与 Vite 类型声明。

## 分层约定

依赖方向自上而下：`pages` / `components` → `stores` → `orchestrator` → `ai` / `domain` / `lib`。`domain/` 保持纯函数、零框架依赖，配套 `*.test.ts` 与实现同目录放置（vitest）。
