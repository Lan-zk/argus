# src/domain/ — 领域核心（纯函数）

审阅业务的纯函数核心：不依赖 Vue / Pinia / Tauri，可独立测试。输入输出均为 [`types.ts`](./types.ts) 中的领域类型。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| `types.ts` | 领域类型：DocumentBlock、Finding、ReviewCategory、ModelConfig、SessionState 等 |
| `parser.ts` | 文稿解析：纯文本 → 带行号的块结构（DocViewer 渲染与定位的共用基底） |
| `anchor.ts` | **三信号定位**：quote 归一化后全文检索 → lineHint 消歧 → djb2 8 位 hex 校验；失败产出 unanchored Finding |
| `normalizer.ts` | quote / 文本归一化（空白、标点），供检索与比对使用 |
| `dedup.ts` | Finding 去重（同类近似引用合并） |
| `prompts.ts` | 四段 Prompt 组装（系统格式契约 + 类别指令 + 全文 + 提交工具说明），格式契约上移系统层（spec: prompt-layering） |
| `default-categories.ts` | 内置 7 类别定义：6 默认启用（逻辑/论点/论证/修辞/结构/清晰度）+ 1 默认禁用（演讲表达） |
| `presets.ts` | 34 个预设模型服务（DeepSeek / Kimi / 智谱 / Qwen / OpenRouter …，含 Base URL 与离线模型目录） |
| `palette.ts` | 自定义类别 10 色调色板（spec: category-colors），色相取内置类别色的空档 |
| `errors.ts` | 错误分类：鉴权 / 限流 / 超时 / 超上下文 / Runtime 等，映射为可读文案与下一步建议 |
| `log.ts` | 领域日志挂接（结构化事件，供会话绑定） |

## 三信号定位（本目录的核心机制）

**行号 + 内容 + hash**——模型返回的 quote 经 `normalizer` 归一化后全文检索；多个候选位置按 `lineHint` 消歧；最终对定位文本做 djb2 8 位 hex 校验。任何单一信号不独立信任，全部通过才标记 anchored；否则保留为 unanchored（右侧显示、左侧不高亮）。

同目录下的 `*.test.ts` 为对应单测（vitest，`npm run test`）。
