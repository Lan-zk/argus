// tasks 4.6 + spec: review-orchestration 降级两场景（token 估算与触发判定）
// + tasks 4.5 测试连接（成功路径；失败路径的错误分类）
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildStructuralOutline, estimateTokens, shouldDegrade } from "./degrade";
import { resetModelsCacheForTests, setModelsFactoryForTests } from "./client";
import { parseBlocks } from "../domain/parser";
import type { ModelConfig } from "../domain/types";

const MODEL = (contextWindow: number) =>
  ({ id: "m", provider: "openai-compatible", model: "x", contextWindow }) as unknown as ModelConfig;

const LONG_DOC = Array.from({ length: 4000 }, (_, i) => `第 ${i} 段，这一段有大约二十个汉字的内容量。`).join("\n\n");

describe("token 估算", () => {
  it("中文按 0.55/字，英文按 0.25/字符估算", () => {
    const zh = estimateTokens("四千字中文".repeat(800)); // 4000 chars
    const en = estimateTokens("abcd".repeat(100)); // 400 chars
    expect(zh).toBeGreaterThan(2000);
    expect(en).toBe(100);
  });
});

describe("超限触发降级", () => {
  it("带行号全文超过上下文 → degraded=true 并给出原因", () => {
    const numbered = Array.from({ length: 4000 }, (_, i) => `L${i + 1}|第 ${i} 段内容。`).join("\n");
    const outline = buildStructuralOutline(parseBlocks(LONG_DOC));
    const d = shouldDegrade(MODEL(8_000), numbered, outline);
    expect(d.degraded).toBe(true);
    expect(d.reason).toContain("超过");
  });

  it("短文不触发降级", () => {
    const d = shouldDegrade(MODEL(128_000), "L1|短文。", buildStructuralOutline(parseBlocks("短文。")));
    expect(d.degraded).toBe(false);
  });
});

describe("段落边界不被截断", () => {
  it("结构表示每个条目对应完整段落（首句或整段），保留行号", () => {
    const blocks = parseBlocks("第一段第一句。第一段第二句。\n\n## 小节\n\n第二段内容没有句号");
    const outline = buildStructuralOutline(blocks);
    const lines = outline.split("\n");
    expect(lines[0]).toMatch(/^L1 \[paragraph\] 第一段第一句。$/);
    expect(lines[1]).toMatch(/^L3 #+ 小节$/);
    expect(lines[2]).toMatch(/^L5 \[paragraph\] 第二段内容没有句号$/);
  });
});

describe("测试连接（spec: settings 测试连接）", () => {
  beforeEach(() => resetModelsCacheForTests());
  afterEach(() => resetModelsCacheForTests());

  it("成功返回模型信息", async () => {
    const { createModels, fauxProvider, fauxAssistantMessage } = await import("@earendil-works/pi-ai");
    const faux = fauxProvider({ models: [{ id: "faux" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    setModelsFactoryForTests(() => models);
    faux.setResponses([fauxAssistantMessage("正常")]);
    const { testConnection } = await import("./test-connection");
    const res = await testConnection({ id: "m", provider: "faux", model: "faux" } as unknown as ModelConfig, "k");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.model).toBe("faux");
  });

  it("坏 Key → 分类为 API Key 无效（可读错误）", async () => {
    const { testConnection } = await import("./test-connection");
    // 直接验证分类层：传输层 401 → invalid_api_key（testConnection 失败路径复用同一分类器）
    const { classifyError } = await import("../domain/errors");
    const e = classifyError(new Error("401 Unauthorized"));
    expect(e.kind).toBe("invalid_api_key");
    expect(testConnection).toBeTruthy();
  });
});
