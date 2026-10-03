# scripts/ — 开发脚本

一次性或辅助性质的开发脚本（Node ESM，`.mjs`），不在应用运行路径上。

## 文件说明

| 脚本 | 职责 |
| --- | --- |
| `mock-openai-server.mjs` | 本地 OpenAI-compatible mock 服务（spike/联调用，默认端口 8931，`MOCK_PORT` 可改）：最小 chat/completions（SSE 流式 + tool_calls）；Bearer 鉴权校验；按请求内容返回 `submit_findings` / `submit_report` 工具调用，quote 取自请求全文的真实句子以保证可定位。等价 vLLM/Ollama 类自建端点 |
| `contrast-check.mjs` | 对比度校验（CI 可用）：解析 `src/styles/tokens.css` 四组合令牌块，复用 `src/lib/contrast.ts` 计算 WCAG 对比度——正文对底 ≥ 4.5:1、图形/强调 ≥ 3:1；任一硬性项不达标 `exit 1` |

## 用法

```bash
node scripts/mock-openai-server.mjs    # 起本地 mock 模型端点
node scripts/contrast-check.mjs        # 主题/类别色改动后跑一次
```
