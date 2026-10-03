/**
 * @vitest-environment node
 */
// Spike（tasks 1.3 go/no-go）：pi-ai complete() 经自定义 fetch（tauri http fetch 的等价签名）完成调用。
// 拦截式验证：注入的 fetch 收到 (url, init) 并返回流式 SSE Response——这正是 tauri http fetch 的接口形状。
// （真实 loopback + 官方 SDK 路径已在 spike 期间的 Node 脚本中验证：OpenAI SDK 尊重 custom fetch，
//   SSE 流式 + tool_calls 解析 + 401 错误体均正常；WebView 内验证由 tauri dev 中的 spike 模块完成。）
import { describe, expect, it } from "vitest";
import { createModels, createProvider, type Message } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

let viaCustomFetch = 0;
let capturedUrl = "";
let capturedAuth = "";

const FINDINGS_ARGS = JSON.stringify({
  findings: [
    {
      severity: "high",
      title: "测试问题",
      quote: "被引用的句子",
      lineHint: 3,
      contentHash: "0a6bdc87",
      problem: "p",
      reason: "r",
      suggestion: "s",
    },
  ],
});

/** 模拟 tauri http fetch：签名与全局 fetch 一致；拦截请求并返回合成的流式 SSE 响应。 */
const tauriLikeFetch: typeof globalThis.fetch = async (input, init) => {
  viaCustomFetch++;
  capturedUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  capturedAuth = h.get("authorization") ?? "";
  if (capturedAuth !== "Bearer spike-key") {
    // 与真实 Provider 一致：401 + JSON 错误体（OpenAI SDK 会将其转换为 APIError 抛出）
    return new Response(
      JSON.stringify({
        error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" },
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }
  const base = { id: "chatcmpl-spike", object: "chat.completion.chunk", created: 1, model: "mock-model" };
  const chunks = [
    { ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: { content: "你好，通道正常。" }, finish_reason: null }] },
    {
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", type: "function", function: { name: "submit_findings", arguments: FINDINGS_ARGS } },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    { ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } },
  ];
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};

function spikeModels() {
  const models = createModels();
  models.setProvider(
    createProvider({
      id: "spike",
      name: "Spike mock",
      baseUrl: "https://mock.example/v1",
      auth: { apiKey: { name: "k", resolve: async () => ({ auth: {} }) } },
      models: [],
      api: openAICompletionsApi(),
    }),
  );
  return models;
}

const SPIKE_MODEL = {
  id: "m",
  name: "m",
  api: "openai-completions",
  provider: "spike",
  baseUrl: "https://mock.example/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
} as unknown as Parameters<ReturnType<typeof createModels>["complete"]>[0];

const CTX = { messages: [{ role: "user", content: "ping", timestamp: Date.now() } as Message] };

describe("Spike：pi-ai + 自定义 fetch（tauri http 通道等价验证）", () => {
  it("complete() 经注入的 fetch 完成流式调用并解析 submit_findings 工具调用", async () => {
    const models = spikeModels();
    const before = viaCustomFetch;
    const assistant = await models.complete(SPIKE_MODEL, CTX, { apiKey: "spike-key", fetch: tauriLikeFetch });
    // 请求确实经过注入的 fetch（tauri 通道等价物），且带鉴权头、打到了 base URL
    expect(viaCustomFetch).toBeGreaterThan(before);
    expect(capturedUrl).toBe("https://mock.example/v1/chat/completions");
    expect(capturedAuth).toBe("Bearer spike-key");
    if (assistant.stopReason === "error") throw new Error(`spike failed: ${assistant.errorMessage}`);
    expect(assistant.stopReason).toBe("toolUse");
    const call = assistant.content.find((b) => b.type === "toolCall");
    expect(call && call.type === "toolCall" && call.name).toBe("submit_findings");
    const args = call && call.type === "toolCall" ? (call.arguments as { findings: unknown[] }) : null;
    expect(args?.findings).toHaveLength(1);
  });

  it("401 错误体归一为 stopReason=error，按分类映射为 API Key 无效（文案指引设置页、不泄漏 Key）", async () => {
    const { classifyError } = await import("../domain/errors");
    const models = spikeModels();
    const assistant = await models.complete(SPIKE_MODEL, CTX, { apiKey: "wrong-key", fetch: tauriLikeFetch });
    expect(assistant.stopReason).toBe("error");
    expect(assistant.errorMessage).toContain("Incorrect API key");
    // 生产路径（callFindings.appErrorFromTransport）对该错误串的分类：
    const appErr = classifyError(new Error(assistant.errorMessage ?? ""), ["wrong-key"]);
    expect(appErr.kind).toBe("invalid_api_key");
    expect(appErr.group).toBe("config");
    expect(appErr.message).toContain("设置 → Models");
    expect(appErr.message).not.toContain("wrong-key");
  });
});
