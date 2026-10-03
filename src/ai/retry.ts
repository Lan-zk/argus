// 重试策略（spec: ai-runtime 自动重试 / PRD §52）。
// 网络类（超时/429）指数退避自动重试 ≤2；配置类（401/404/BaseURL）不重试。

import type { AppError } from "../domain/errors";
import { sleep } from "../domain/errors";

export const MAX_AUTO_RETRIES = 2;

export function isRetryable(err: AppError): boolean {
  return err.group === "retryable";
}

export interface RetryHooks {
  /** 每次准备重试前回调（界面显示「正在重试」状态）。 */
  onRetry?: (attempt: number, err: AppError) => void;
  signal?: AbortSignal;
}

/** 指数退避：500ms * 2^(attempt-1)，上限 8s。 */
export function backoffDelay(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 8000);
}

/**
 * 执行 fn；仅对 retryable（超时/Rate Limit）错误自动重试至多 MAX_AUTO_RETRIES 次。
 * 配置类错误立即上抛。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  toAppError: (err: unknown) => AppError,
  hooks: RetryHooks = {},
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (raw) {
      const err = toAppError(raw);
      if (!isRetryable(err) || attempt >= MAX_AUTO_RETRIES) throw err;
      attempt++;
      hooks.onRetry?.(attempt, err);
      await sleep(backoffDelay(attempt));
      if (hooks.signal?.aborted) throw err;
    }
  }
}
