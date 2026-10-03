# src/ai/ — AI Runtime 封装（pi-ai）

对 `@earendil-works/pi-ai` 的封装层：屏蔽各 Provider 差异，向 orchestrator 提供「一个类别一次审阅调用」的稳定接口。模型请求经 `src/lib/tauri.ts` 安装的 Tauri http fetch 通道从 Rust 侧发出（免 CORS）。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| `client.ts` | provider 工厂：按 ModelConfig（OpenAI / Anthropic / Google / OpenAI-compatible）创建 pi-ai 客户端 |
| `findings-tool.ts` | `submit_findings` / `submit_report` 工具 schema：以 Structured Output 约束模型返回的 Finding 结构 |
| `call.ts` | 单类别审阅调用：领域 Prompt 组装 → pi-ai `complete()` → 结构化输出校验与自动修复 |
| `retry.ts` | 重试策略（限流 / 瞬时错误的退避重试） |
| `degrade.ts` | 长文降级：文稿超出 Context Window 时的判定与降级行为 |
| `model-discovery.ts` | 模型列表检索：向端点拉取可用模型（含离线静态目录与推荐默认，见 `domain/presets.ts`） |
| `test-connection.ts` | 测试连接：真实调用一次并返回模型信息或分类后的可读错误 |

## 测试

`call.test.ts` / `degrade.test.ts` / `model-discovery.test.ts` / `spike-transport.test.ts` 覆盖调用、降级、模型发现与传输通道；Provider 差异用 faux provider 与 401/404/429/超时/超限分类模拟。联调用本地 mock 服务见 [`scripts/mock-openai-server.mjs`](../../scripts/README.md)。
