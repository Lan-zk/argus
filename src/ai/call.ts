// 单次类别调用管道（spec: ai-runtime Structured Output 校验与自动修复）。
// complete() 非流式（design 决策 7）→ 提取 submit_findings 工具调用 → TypeBox 校验。
// 校验失败带错误反馈自动修复一次；仍失败抛「Structured Output 无效」。

import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { validateToolArguments } from "@earendil-works/pi-ai";
import type { ModelConfig } from "../domain/types";
import { appError, classifyError, redact, type AppError } from "../domain/errors";
import { resolveModel } from "./client";
import { SubmitFindingsTool, type ToolFinding } from "./findings-tool";

export interface CallOptions {
  apiKey: string;
  signal?: AbortSignal;
}

function contentText(m: AssistantMessage): string {
  return m.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function extractToolCall(m: AssistantMessage): { id: string; args: unknown } | null {
  for (const b of m.content) {
    if (b.type === "toolCall" && b.name === SubmitFindingsTool.name) {
      return { id: b.id, args: b.arguments };
    }
  }
  return null;
}

function validationErrorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 校验工具调用参数；非法时抛出带细节的错误（由调用方决定是否进入修复轮）。 */
function parseFindings(toolArgs: unknown): ToolFinding[] {
  const obj = toolArgs as { findings?: unknown };
  if (!obj || !Array.isArray(obj.findings)) {
    throw new Error("findings 字段缺失或不是数组");
  }
  return obj.findings as ToolFinding[];
}

/**
 * 调用模型获取结构化 Findings。
 * 抛出的 AppError.kind = invalid_structured_output 表示含一次自动修复后仍失败。
 */
export async function callFindings(
  cfg: ModelConfig,
  systemPrompt: string,
  userPrompt: string,
  opts: CallOptions,
): Promise<ToolFinding[]> {
  const { models, model } = await resolveModel(cfg);
  const messages: Message[] = [{ role: "user", content: userPrompt, timestamp: Date.now() }];

  let lastError: AppError | null = null;
  // 主调用 + 至多一次自动修复（design 决策 5）
  for (let attempt = 0; attempt < 2; attempt++) {
    let assistant: AssistantMessage;
    try {
      assistant = await models.complete(
        model,
        { systemPrompt, messages, tools: [SubmitFindingsTool] },
        {
          apiKey: opts.apiKey,
          signal: opts.signal,
          maxRetries: 0,
          // 会话路由/亲和：OpenCode 网关要求 x-opencode-session（缺省 400 MissingSessionID）；
          // 其余 Provider 用于 prompt 缓存亲和，稳定值即安全
          sessionId: `argus-${cfg.id}`,
          ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
          ...(cfg.maxTokens !== undefined ? { maxTokens: cfg.maxTokens } : {}),
        },
      );
    } catch (err) {
      // 传输层失败不属于 Structured Output 问题，直接上抛交由重试策略处理
      throw appErrorFromTransport(err, cfg);
    }

    if (assistant.stopReason === "error") {
      throw appErrorFromTransport(
        new Error(assistant.errorMessage || "provider stream error"),
        cfg,
      );
    }

    const call = extractToolCall(assistant);
    if (!call) {
      lastError = appError(
        "invalid_structured_output",
        `（模型未调用 submit_findings，返回了${contentText(assistant) ? "文本" : "空内容"}）`,
      );
    } else {
      try {
        const validated = validateToolArguments(SubmitFindingsTool, {
          type: "toolCall",
          id: call.id,
          name: SubmitFindingsTool.name,
          arguments: call.args as Record<string, never>,
        });
        return parseFindings(validated);
      } catch (err) {
        lastError = appError(
          "invalid_structured_output",
          `（Schema 校验失败：${redact(validationErrorDetail(err))}）`,
        );
      }
    }

    if (attempt === 0) {
      // 自动修复一次：把失败原因作为工具结果/用户反馈回传，要求重新提交
      const toolMsg: Message =
        call && lastError
          ? {
              role: "toolResult",
              toolCallId: call.id,
              toolName: SubmitFindingsTool.name,
              content: [
                {
                  type: "text",
                  text: `提交无效：${lastError.message}。请严格按照 Output Schema 重新调用 submit_findings。`,
                },
              ],
              isError: true,
              timestamp: Date.now(),
            }
          : {
              role: "user",
              content:
                "你没有调用 submit_findings 工具。请严格按 Output Schema 以一次 submit_findings 工具调用返回全部结果（可为空数组），不要输出自由文本。",
              timestamp: Date.now(),
            };
      messages.push({ role: "assistant", content: assistant.content, timestamp: assistant.timestamp } as Message);
      messages.push(toolMsg);
    }
  }

  throw lastError ?? appError("invalid_structured_output");
}

function appErrorFromTransport(err: unknown, cfg: ModelConfig): AppError {
  return classifyError(err, [cfg.apiKey ?? ""]);
}
