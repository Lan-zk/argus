// 测试连接（spec: settings / PRD §44）。
// 成功返回模型信息；失败返回分类可读错误与下一步建议。

import type { ModelConfig } from "../domain/types";
import { appError, type AppError } from "../domain/errors";
import { resolveModel } from "./client";
import { classifyError } from "../domain/errors";

export type TestResult =
  | { ok: true; model: string; provider: string; usage?: string }
  | { ok: false; error: AppError };

/** 最小真实调用：不依赖工具与审阅 Prompt，验证连通 / 鉴权 / 模型名。 */
export async function testConnection(
  cfg: ModelConfig,
  apiKey: string,
  signal?: AbortSignal,
): Promise<TestResult> {
  const { models, model } = resolveModel(cfg);
  try {
    const assistant = await models.complete(
      model,
      {
        systemPrompt: "你是连通性探针。",
        messages: [
          { role: "user", content: "请只回复两个字：正常", timestamp: Date.now() },
        ],
      },
      {
        apiKey,
        signal,
        maxRetries: 0,
        maxTokens: 32,
        ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
      },
    );
    if (assistant.stopReason === "error") {
      return { ok: false, error: classifyError(new Error(assistant.errorMessage ?? "provider error"), [apiKey]) };
    }
    const text = assistant.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    return {
      ok: true,
      model: assistant.responseModel ?? cfg.model,
      provider: cfg.provider,
      usage: text.trim() ? undefined : "（空回复，但连接成功）",
    };
  } catch (err) {
    return { ok: false, error: classifyError(err, [apiKey]) };
  }
}

export { appError };
