// 长文降级（spec: review-orchestration / PRD §34–37）。
// token 估算超限判定 + 文档结构表示生成（标题层级 + 行号索引 + 段落首句，不截断句子）。
// 降级是整体策略：结构表示替代全文进入同一调用管道，定位算法不变。

import type { DocumentBlock, ModelConfig } from "../domain/types";
import { renderStructuralOutline } from "../domain/prompts";
import { defaultContextWindow } from "./client";

/** 估算 token 数：CJK 字符 ≈ 0.55 token/字，非 CJK ≈ 0.25 token/字符。 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const other = text.length - cjk;
  return Math.ceil(cjk * 0.55 + other * 0.25);
}

/** Prompt 固定开销估算（System Instruction + Output Schema + 类别 Prompt）。 */
export const PROMPT_OVERHEAD_TOKENS = 1_200;

/** 一次调用的 token 预算 = 带行号全文 + 固定开销 + 输出预留。 */
export function estimateCallTokens(opts: {
  documentText: string;
  outlineText?: string;
  maxTokens?: number;
}): number {
  const input = estimateTokens(opts.documentText);
  const reserveOut = opts.maxTokens ?? 4_096;
  return PROMPT_OVERHEAD_TOKENS + input + (opts.outlineText ? estimateTokens(opts.outlineText) : 0) + reserveOut;
}

export interface DegradeDecision {
  degraded: boolean;
  reason?: string;
  contextWindow: number;
  estimatedTokens: number;
}

/** 判定是否需要结构化降级。安全系数 0.92（留余量给行号膨胀与模型分词差异）。 */
export function shouldDegrade(
  cfg: ModelConfig,
  numberedDocumentText: string,
  outlineText: string,
): DegradeDecision {
  const contextWindow = cfg.contextWindow ?? defaultContextWindow(cfg.provider);
  const estimatedTokens = estimateCallTokens({
    documentText: numberedDocumentText,
    outlineText,
    maxTokens: cfg.maxTokens,
  });
  const degraded = estimatedTokens > contextWindow * 0.92;
  return {
    degraded,
    reason: degraded
      ? `估算 ${estimatedTokens.toLocaleString()} tokens 超过模型上下文 ${contextWindow.toLocaleString()} 的安全容量`
      : undefined,
    contextWindow,
    estimatedTokens,
  };
}

/** 生成文档结构表示（PRD §36 第一步）。 */
export function buildStructuralOutline(blocks: DocumentBlock[]): string {
  return renderStructuralOutline(blocks);
}
