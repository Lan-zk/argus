// 错误分类（spec: ai-runtime / PRD §51–52）。
// 九类错误，三组行为：可重试（网络类）/ 不重试（配置类）/ 超限。
// 错误文案必须告诉用户下一步检查什么，不得只显示状态码；全文案不得包含完整 API Key。

import { dlog } from "./log";

export type AppErrorKind =
  | "invalid_api_key"
  | "model_not_found"
  | "base_url_unreachable"
  | "timeout"
  | "rate_limit"
  | "context_overflow"
  | "invalid_structured_output"
  | "runtime_error"
  | "unknown";

export type ErrorGroup = "retryable" | "config" | "overflow" | "fatal";

export interface AppError {
  kind: AppErrorKind;
  group: ErrorGroup;
  /** 可读文案，含下一步建议。 */
  message: string;
  cause?: unknown;
}

/** 脱敏任意字符串：抹掉疑似 Key 的长 token 与已知的明文 Key。 */
export function redact(text: string, knownKeys: string[] = []): string {
  let out = text;
  for (const k of knownKeys) {
    if (k && k.length >= 6) out = out.split(k).join("[已脱敏]");
  }
  // sk-…、Bearer 后长 token、通用长密钥样式
  out = out.replace(/(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]{6,}/g, "$1…[已脱敏]");
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1[已脱敏]");
  out = out.replace(/\b([A-Fa-f0-9_-]{24,})\b/g, "[已脱敏]");
  return out;
}

function msg(kind: AppErrorKind, extra = ""): string {
  switch (kind) {
    case "invalid_api_key":
      return `API Key 无效（401）。请到 设置 → Models 检查该模型的 Key；此类配置错误不会自动重试。${extra}`;
    case "model_not_found":
      return `模型不存在（404）。请检查模型名称拼写是否与 Provider 一致；此类配置错误不会自动重试。${extra}`;
    case "base_url_unreachable":
      return `Base URL 无法连接。请检查网络与 Base URL 地址是否正确（含 https:// 前缀与版本路径）；此类配置错误不会自动重试。${extra}`;
    case "timeout":
      return `Provider 请求超时。建议检查网络后重跑该类别；网络类错误已自动重试至多 2 次。${extra}`;
    case "rate_limit":
      return `Rate Limit（429）。请求过于频繁，已自动重试至多 2 次；建议稍后重跑或降低并发。${extra}`;
    case "context_overflow":
      return `Context Length 超限。当前模型上下文装不下带行号全文，系统已按文档结构表示降级执行；若仍失败，请换更大上下文的模型。${extra}`;
    case "invalid_structured_output":
      return `Structured Output 无效。模型未能通过 Schema 校验（含一次自动修复）。建议重跑该类别或更换遵循指令更稳的模型。${extra}`;
    case "runtime_error":
      return `Runtime 错误。模型调用通道异常，请重试；持续出现请检查应用日志。${extra}`;
    default:
      return `未知错误。请重跑该类别；持续出现请检查模型配置与网络。${extra}`;
  }
}

export function appError(kind: AppErrorKind, extra = "", cause?: unknown): AppError {
  const group: ErrorGroup =
    kind === "timeout" || kind === "rate_limit"
      ? "retryable"
      : kind === "context_overflow"
        ? "overflow"
        : kind === "invalid_structured_output" || kind === "runtime_error"
          ? "fatal"
          : "config";
  return { kind, group, message: msg(kind, extra), cause };
}

const OVERFLOW_PATTERNS = [
  /context[_ ]length/i,
  /maximum context/i,
  /too many tokens/i,
  /max.*tokens.*exceed/i,
  /prompt is too long/i,
  /exceeds.*context/i,
  /input.*too long/i,
  /content.*too large/i,
];

/**
 * 把任意 Provider/Runtime 错误归一为 AppError。
 * 识别顺序：HTTP 状态码特征 → 超时特征 → 超限文案 → 连接失败 → 兜底。
 */
export function classifyError(err: unknown, knownKeys: string[] = []): AppError {
  const raw = (() => {
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    return String(err);
  })();
  const text = redact(raw, knownKeys);
  const cause = err;

  // SDK / pi-ai 常见状态码标记（APIError.status、message 中的 401/404/429 等）
  const status = extractStatus(err);
  if (status === 401 || status === 403) return appError("invalid_api_key", "", cause);
  if (status === 404) return appError("model_not_found", "", cause);
  if (status === 429) return appError("rate_limit", "", cause);
  if (status === 400 && OVERFLOW_PATTERNS.some((p) => p.test(raw)))
    return appError("context_overflow", "", cause);

  if (/timeout|timed?\s*out|ETIMEDOUT|AbortError/i.test(raw))
    return appError("timeout", "", cause);
  if (OVERFLOW_PATTERNS.some((p) => p.test(raw))) return appError("context_overflow", "", cause);
  if (/rate\s*limit|too many requests/i.test(raw)) return appError("rate_limit", "", cause);
  if (/failed to fetch|fetch failed|network|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|connection (refused|error)/i.test(raw))
    return appError("base_url_unreachable", "", cause);
  if (/not allowed on the configured scope/i.test(raw))
    return appError("runtime_error", "（http 插件 capability 范围未覆盖该地址）", cause);
  if (/invalid api key|unauthorized|authentication|auth failed|incorrect api key/i.test(raw))
    return appError("invalid_api_key", "", cause);
  if (/not found/i.test(raw)) return appError("model_not_found", "", cause);

  dlog("错误", `未分类错误 → ${text}`, true);
  return appError("unknown", "", cause);
}

function extractStatus(err: unknown): number | null {
  if (typeof err === "object" && err !== null) {
    const anyErr = err as Record<string, unknown>;
    for (const key of ["status", "statusCode"]) {
      const v = anyErr[key];
      if (typeof v === "number") return v;
    }
    const inner = anyErr.error ?? anyErr.cause;
    if (inner) {
      const s = extractStatus(inner);
      if (s !== null) return s;
    }
  }
  const m = String(err).match(/\b(400|401|403|404|429|500|502|503)\b/);
  return m ? Number(m[1]) : null;
}

/** sleep 工具（重试退避用）。 */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
