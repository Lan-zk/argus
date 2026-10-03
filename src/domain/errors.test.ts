// spec: ai-runtime 错误分类场景（401/404/超时/429/超限映射与可读文案、Key 脱敏）+ 重试策略
import { describe, expect, it } from "vitest";
import { appError, classifyError, redact } from "./errors";
import { MAX_AUTO_RETRIES, backoffDelay, isRetryable, withRetry } from "../ai/retry";

describe("错误映射", () => {
  it("401 → API Key 无效（配置类，不重试），文案指引到设置", () => {
    const e = classifyError(new Error("Request failed with status 401"));
    expect(e.kind).toBe("invalid_api_key");
    expect(e.group).toBe("config");
    expect(e.message).toContain("设置 → Models");
    expect(e.message).not.toMatch(/^\s*401\s*$/);
  });

  it("404 → 模型不存在（配置类）", () => {
    const e = classifyError(new Error("404 model not found"));
    expect(e.kind).toBe("model_not_found");
    expect(e.group).toBe("config");
  });

  it("超时 → 可重试", () => {
    const e = classifyError(new Error("Request timed out after 30000ms"));
    expect(e.kind).toBe("timeout");
    expect(isRetryable(e)).toBe(true);
  });

  it("429 / rate limit → 可重试", () => {
    const e = classifyError({ status: 429, message: "too many requests" });
    expect(e.kind).toBe("rate_limit");
    expect(isRetryable(e)).toBe(true);
  });

  it("上下文超限 → 超限组", () => {
    const e = classifyError(new Error("This model's maximum context length is 8192 tokens, however you requested 12000"));
    expect(e.kind).toBe("context_overflow");
    expect(e.group).toBe("overflow");
  });

  it("连接失败 → Base URL 无法连接（配置类）", () => {
    const e = classifyError(new TypeError("fetch failed: ECONNREFUSED"));
    expect(e.kind).toBe("base_url_unreachable");
    expect(isRetryable(e)).toBe(false);
  });

  it("结构化输出无效", () => {
    const e = appError("invalid_structured_output");
    expect(e.message).toContain("Structured Output 无效");
    expect(e.message).toContain("重跑");
  });
});

describe("Key 脱敏", () => {
  it("错误文案不含完整 API Key（含已知 Key 与样式脱敏）", () => {
    const key = "sk-very-secret-key-1234567890abcdef";
    const e = classifyError(new Error(`auth failed for key ${key}`), [key]);
    expect(e.kind).toBe("invalid_api_key");
    expect(e.message).not.toContain(key);
    expect(redact(`x ${key} y`, [key])).not.toContain(key);
    expect(redact("token sk-abcd1234567890abcdef")).toContain("[已脱敏]");
  });

  it("redact 处理 sk- 与 Bearer 形态", () => {
    const out = redact("bad key sk-abcd1234567890abcdef and Bearer token1234567890abcdef");
    expect(out).not.toContain("sk-abcd1234567890abcdef");
    expect(out).not.toContain("token1234567890abcdef");
  });
});

describe("重试策略（spec: ai-runtime 重试两场景）", () => {
  it("超时自动重试至多 2 次后成功", async () => {
    let calls = 0;
    const seen: number[] = [];
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw appError("timeout");
        return "ok";
      },
      (e) => e as Parameters<typeof isRetryable>[0],
      { onRetry: (n) => seen.push(n) },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(seen).toEqual([1, 2]);
  });

  it("重试次数达上限后仍失败则抛出", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw appError("rate_limit");
        },
        (e) => e as Parameters<typeof isRetryable>[0],
      ),
    ).rejects.toMatchObject({ kind: "rate_limit" });
    expect(calls).toBe(MAX_AUTO_RETRIES + 1);
  });

  it("配置类错误（401）不自动重试", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw appError("invalid_api_key");
        },
        (e) => e as Parameters<typeof isRetryable>[0],
      ),
    ).rejects.toMatchObject({ kind: "invalid_api_key" });
    expect(calls).toBe(1);
  });

  it("指数退避延迟递增且有上限", () => {
    expect(backoffDelay(1)).toBe(500);
    expect(backoffDelay(2)).toBe(1000);
    expect(backoffDelay(3)).toBe(2000);
    expect(backoffDelay(10)).toBe(8000);
  });
});
