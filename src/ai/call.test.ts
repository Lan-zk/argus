// tasks 4.2/4.3：submit_findings 工具调用封装 + 自动修复一次（spec: ai-runtime Structured Output 场景）
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type FauxResponseStep,
  type MutableModels,
} from "@earendil-works/pi-ai";
import { resetModelsCacheForTests, setModelsFactoryForTests } from "./client";
import { callFindings } from "./call";
import type { ModelConfig } from "../domain/types";

const MODEL = { id: "m", provider: "faux", model: "faux" } as unknown as ModelConfig;
const SYS = "sys";
const USER = "user prompt";

const VALID = {
  findings: [
    {
      severity: "high",
      title: "推理跳跃",
      quote: "quote text",
      lineHint: 19,
      contentHash: "0a6bdc87",
      problem: "p",
      reason: "r",
      suggestion: "s",
    },
  ],
};

beforeEach(() => resetModelsCacheForTests());
afterEach(() => resetModelsCacheForTests());

async function setup(responses: FauxResponseStep[]) {
  const faux = fauxProvider({ models: [{ id: "faux" }] });
  const models: MutableModels = createModels();
  models.setProvider(faux.provider);
  setModelsFactoryForTests(() => models);
  faux.setResponses(responses);
  return faux;
}

describe("会话路由头（OpenCode MissingSessionID 回归）", () => {
  it("callFindings 传递稳定 sessionId（pi-ai 据此注入 x-opencode-session）", async () => {
    const { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
    resetModelsCacheForTests();
    let captured: Record<string, unknown> | null = null;
    void captured;
    const faux = fauxProvider({ models: [{ id: "faux" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const orig = models.complete.bind(models);
    models.complete = ((model: unknown, ctx: unknown, opts?: Record<string, unknown>) => {
      captured = { ...(opts ?? {}) };
      return orig(model as never, ctx as never, opts as never);
    }) as typeof models.complete;
    setModelsFactoryForTests(() => models);
    faux.setResponses([fauxAssistantMessage([fauxToolCall("submit_findings", VALID)])]);
    const findings = await callFindings(MODEL, SYS, USER, { apiKey: "k" });
    expect(findings).toHaveLength(1);
    expect((captured as Record<string, unknown> | null)?.sessionId).toBe("argus-m");
    resetModelsCacheForTests();
  });
});

describe("合法结构化输出通过", () => {
  it("submit_findings 工具调用返回 → 进入后续流程", async () => {
    await setup([fauxAssistantMessage([fauxToolCall("submit_findings", VALID)])]);
    const findings = await callFindings(MODEL, SYS, USER, { apiKey: "k" });
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe("推理跳跃");
    expect(findings[0].severity).toBe("high");
  });
});

describe("非法输出自动修复一次", () => {
  it("首次返回自由文本（无工具调用），修复轮返回合法工具调用 → 成功", async () => {
    await setup([
      fauxAssistantMessage([fauxText("我觉得没有问题。")]),
      fauxAssistantMessage([fauxToolCall("submit_findings", VALID)]),
    ]);
    const findings = await callFindings(MODEL, SYS, USER, { apiKey: "k" });
    expect(findings).toHaveLength(1);
  });

  it("首次 Schema 校验失败（severity 非法），修复轮合法 → 成功", async () => {
    await setup([
      fauxAssistantMessage([fauxToolCall("submit_findings", { findings: [{ ...VALID.findings[0], severity: "critical" }] })]),
      fauxAssistantMessage([fauxToolCall("submit_findings", VALID)]),
    ]);
    const findings = await callFindings(MODEL, SYS, USER, { apiKey: "k" });
    // TypeBox 校验在主路径拒绝 severity: critical，修复轮返回合法值
    expect(findings[0].severity).toBe("high");
  });
});

describe("修复仍失败", () => {
  it("两次都无工具调用 → 抛 Structured Output 无效", async () => {
    await setup([fauxAssistantMessage([fauxText("nope")]), fauxAssistantMessage([fauxText("still nope")])]);
    await expect(callFindings(MODEL, SYS, USER, { apiKey: "k" })).rejects.toMatchObject({
      kind: "invalid_structured_output",
    });
  });

  it("两次 Schema 都失败（findings 缺字段）→ 抛 Structured Output 无效", async () => {
    const bad = fauxAssistantMessage([
      fauxToolCall("submit_findings", { findings: [{ title: "缺字段" }] }),
    ]);
    await setup([bad, bad]);
    await expect(callFindings(MODEL, SYS, USER, { apiKey: "k" })).rejects.toMatchObject({
      kind: "invalid_structured_output",
    });
  });
});
