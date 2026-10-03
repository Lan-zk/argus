# src/lib/ — 基础设施

前端与 Tauri 壳之间的桥接层及通用工具：环境探测、网络通道、钥匙串、持久化、主题、对比度。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| `tauri.ts` | Tauri 环境探测与 **fetch 通道安装**：WebView 内把 `globalThis.fetch` 替换为 tauri http 插件 fetch（模型请求经 Rust 侧发出，免 CORS）；纯浏览器模式保留原生 fetch |
| `keyring.ts` | 钥匙串封装：调用 Rust 侧 `keyring_*` command 存取 API Key；浏览器模式走内存兜底 |
| `persistence.ts` | 持久化（tauri-plugin-store）：settings 与最近一次 Review（原文、findings、报告）的读写；浏览器模式内存兜底 |
| `theme.ts` | 主题应用（spec: theme-system）：组合出 `data-theme` 并挂到根元素 |
| `contrast.ts` | WCAG 对比度计算（正文 ≥ 4.5:1、图形 ≥ 3:1），供 CategoryColorPicker 低对比提示与 [`scripts/contrast-check.mjs`](../../scripts/README.md) 复用 |
| `constants.ts` | 全局常量（如文稿长度上限 30 000 字符） |
| `sample.ts` | 示例文稿（新建审阅页的试用内容） |
| `dev-spike.ts` | 开发联调钩子（**仅 debug 构建生效**）：经 Rust 侧 `dev_spike_*` command 读写 spike 文件，驱动应用内全链路验证，见 [`docs/known-issues.md`](../../docs/README.md) |

`*.test.ts` 为对应单测（vitest）。
