// 任务 2.1–2.4 单测：resolveModel 注册表分发 + 模型发现三层。
// fetchRemoteModels 的网络用拦截式 fetch mock（沙箱内无 loopback）。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetModelsCacheForTests, resolveModel } from "./client";
import { catalogModels, customFetchInput, fetchRemoteModels, mergeModels, presetFetchInput } from "./model-discovery";
import type { ModelConfig } from "../domain/types";

beforeEach(() => resetModelsCacheForTests());
afterEach(() => resetModelsCacheForTests());

describe("2.1 resolveModel 注册表分发", () => {
  it("deepseek 预设：从 pi-ai 目录取模型（含 contextWindow 元数据，openai-completions 家族）", async () => {
    const { model } = await resolveModel({ id: "m", provider: "deepseek", model: "deepseek-flash" } as ModelConfig);
    expect(model.id).toBe("deepseek-flash");
    expect(model.contextWindow).toBeGreaterThan(100_000);
    expect(model.api).toBe("openai-completions");
    expect(model.baseUrl).toBe("https://api.deepseek.com");
  });

  it("minimax 预设：走 anthropic-messages 协议（pi-ai 处理家族差异）", async () => {
    const { model } = await resolveModel({ id: "m", provider: "minimax", model: "MiniMax-M2.7" } as ModelConfig);
    expect(model.api).toBe("anthropic-messages");
    expect(model.baseUrl).toContain("minimax");
  });

  it("openrouter 预设：聚合目录可取任意模型", async () => {
    const { model } = await resolveModel({
      id: "m",
      provider: "openrouter",
      model: "anthropic/claude-haiku-4.5",
    } as ModelConfig);
    expect(model.provider).toBe("openrouter");
  });

  it("目录外手动输入的模型 id 仍可用（api/baseUrl 取目录首项）", async () => {
    const { model } = await resolveModel({ id: "m", provider: "deepseek", model: "deepseek-custom-x" } as ModelConfig);
    expect(model.id).toBe("deepseek-custom-x");
    expect(model.api).toBe("openai-completions");
    expect(model.baseUrl).toBe("https://api.deepseek.com");
  });

  it("目录外手动输入：api 家族按目录主流推断（opencode 混合目录）", async () => {
    const { getPresetProvider } = await import("./client");
    const provider = await getPresetProvider("opencode");
    const catalog = provider!.getModels();
    const counts = new Map<string, number>();
    for (const m of catalog) counts.set(m.api, (counts.get(m.api) ?? 0) + 1);
    const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const { model } = await resolveModel({ id: "m", provider: "opencode", model: "zen-custom-x" } as ModelConfig);
    expect(model.api).toBe(majority);
    expect(model.baseUrl).toBe("https://opencode.ai/zen");
  });

  it("目录外手动输入：单一目录家族直取（deepseek）", async () => {
    const { model } = await resolveModel({ id: "m", provider: "deepseek", model: "deepseek-custom-y" } as ModelConfig);
    expect(model.api).toBe("openai-completions");
    expect(model.baseUrl).toBe("https://api.deepseek.com");
  });

  it("旧 4 家族回归：openai-compatible 自定义 baseUrl 不变", async () => {
    const { model } = await resolveModel({
      id: "m9",
      provider: "openai-compatible",
      model: "any-model",
      baseUrl: "https://custom.example/v1",
    } as ModelConfig);
    expect(model.baseUrl).toBe("https://custom.example/v1");
    expect(model.api).toBe("openai-completions");
  });
});

describe("2.2 catalogModels 静态目录", () => {
  it("deepseek 目录非空且带元数据与推荐标记", async () => {
    const models = await catalogModels("deepseek");
    expect(models.length).toBeGreaterThanOrEqual(2);
    const flash = models.find((m) => m.id === "deepseek-flash")!;
    expect(flash.contextWindow).toBeGreaterThan(0);
    expect(flash.source).toBe("catalog");
    expect(models.find((m) => m.recommended)?.id).toBe("deepseek-flash");
  });

  it("未知 Provider id 返回空数组", async () => {
    expect(await catalogModels("no-such-provider")).toEqual([]);
  });
});

describe("2.3 fetchRemoteModels 实时检索", () => {
  const REAL_FETCH = globalThis.fetch;

  function mockFetch(status: number, body: unknown) {
    globalThis.fetch = (async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = REAL_FETCH;
  });

  it("200 + data[].id 解析成功", async () => {
    mockFetch(200, { data: [{ id: "model-a" }, { id: "model-b" }, { id: "" }, { no: "id" }] });
    const r = await fetchRemoteModels({ baseUrl: "https://x.example/v1", apiKey: "sk-k", family: "openai-completions" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.models.map((m) => m.id)).toEqual(["model-a", "model-b"]);
  });

  it("401 → API Key 无效可读错误，且不含 Key 明文", async () => {
    mockFetch(401, { error: { message: "Incorrect API key provided" } });
    const r = await fetchRemoteModels({ baseUrl: "https://x.example/v1", apiKey: "sk-leak-me-123", family: "openai-completions" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error?.kind).toBe("invalid_api_key");
      expect(r.reason).not.toContain("sk-leak-me-123");
    }
  });

  it("非标响应/解析失败 → 可读降级，不抛异常", async () => {
    mockFetch(200, "not-json<");
    const r = await fetchRemoteModels({ baseUrl: "https://x.example/v1", apiKey: "k", family: "openai-completions" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(typeof r.reason).toBe("string");
  });

  it("google 家族：不支持在线检索，静默降级", async () => {
    const r = await fetchRemoteModels({ baseUrl: "https://x", apiKey: "k", family: "google-generative-ai" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("手动输入");
  });

  it("非 http(s) 协议拒绝发起请求（安全审计回归：不放行 file:/data: 等 scheme）", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    for (const bad of ["file:///etc/models", "data:text/plain,x", "ftp://x.example"]) {
      const r = await fetchRemoteModels({ baseUrl: bad, apiKey: "k", family: "openai-completions" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("协议");
    }
    expect(called).toBe(false);
  });

  it("anthropic 家族带 anthropic-version 头", async () => {
    let seen: Headers | null = null;
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return new Response(JSON.stringify({ data: [{ id: "claude-x" }] }), { status: 200 });
    }) as typeof fetch;
    const r = await fetchRemoteModels({ baseUrl: "https://x", apiKey: "k", family: "anthropic-messages" });
    expect(r.ok).toBe(true);
    expect(seen!.get("anthropic-version")).toBe("2023-06-01");
  });

  it("空 Base URL 直接失败不发起请求", async () => {
    const r = await fetchRemoteModels({ baseUrl: " ", apiKey: "k", family: "openai-completions" });
    expect(r.ok).toBe(false);
  });
});

describe("2.4 mergeModels 合并去重", () => {
  it("重叠合并（静态优先保留元数据）、互斥并集、空输入安全", () => {
    const cat = [{ id: "a", source: "catalog" as const }, { id: "b", source: "catalog" as const, contextWindow: 1000 }];
    const rem = [{ id: "b", source: "remote" as const }, { id: "c", source: "remote" as const }];
    const merged = mergeModels(cat, rem);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(merged.find((m) => m.id === "b")?.source).toBe("catalog");
    expect(merged.find((m) => m.id === "b")?.contextWindow).toBe(1000);
    expect(mergeModels([], [{ id: "x", source: "remote" as const }]).map((m) => m.id)).toEqual(["x"]);
    expect(mergeModels([], [])).toEqual([]);
  });
});

describe("检索输入构造", () => {
  it("presetFetchInput 取 Provider baseUrl 与家族", async () => {
    const input = await presetFetchInput("deepseek", "sk-k");
    expect(input?.baseUrl).toBe("https://api.deepseek.com");
    expect(input?.family).toBe("openai-completions");
  });

  it("customFetchInput 按四家族映射", () => {
    expect(customFetchInput({ provider: "anthropic", baseUrl: "https://a" }, "k").family).toBe("anthropic-messages");
    expect(customFetchInput({ provider: "openai-compatible", baseUrl: "https://b" }, "k").family).toBe(
      "openai-completions",
    );
  });
});
