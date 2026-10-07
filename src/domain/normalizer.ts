// Finding 规范化（spec: finding-pipeline）。应用侧校验，不依赖 Prompt。
// 必填字段校验、空字段清理、非法 severity 修复、空 quote 丢弃并记日志。
// spec: finding-anchor-spans —— 解析可选 span（主锚行范围）与 refs（引用锚 ≤2），
// 构建 anchors（primary 在前）；不返回新字段时行为与旧版完全一致。

import type { Finding, FindingAnchor, Severity } from "./types";
import { dlog } from "./log";

/** 引用锚数量上限（spec: ai-runtime 格式契约）。 */
export const MAX_REFS = 2;

export interface NormalizedResult {
  findings: Finding[];
  dropped: number;
}

const SEVERITY_ALIASES: Record<string, Severity> = {
  high: "high",
  medium: "medium",
  low: "low",
  critical: "high",
  blocker: "high",
  major: "medium",
  minor: "low",
  info: "low",
  suggestion: "low",
  严重: "high",
  建议修改: "medium",
  可优化: "low",
};

/** 非法 severity 按规则映射；无法映射时降为 medium 并记日志。 */
export function repairSeverity(v: unknown, title: string): Severity {
  if (typeof v === "string") {
    const hit = SEVERITY_ALIASES[v.trim().toLowerCase()];
    if (hit) return hit;
  }
  dlog("规范化", `「${title}」非法 severity（${JSON.stringify(v ?? null)}）→ 修复为 medium`, true);
  return "medium";
}

function cleanText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** 行号字段容错解析（数字或数字字符串 → 正整数，否则 undefined）。 */
function toLine(v: unknown): number | undefined {
  const n =
    (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined) ??
    (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Math.round(Number(v)) : undefined);
  return n && n > 0 ? n : undefined;
}

/**
 * 解析可选 span（主锚行范围）：{ fromLine, toLine } 均为合法正整数才采用，
 * 否则忽略 span（主锚退回句级）并记日志。
 */
function parseSpan(item: Record<string, unknown>, title: string): { fromLine: number; toLine: number } | undefined {
  const span = item.span;
  if (span === undefined || span === null) return undefined;
  if (typeof span !== "object") {
    dlog("规范化", `「${title}」span 非对象 → 忽略行范围，主锚按句级处理`, true);
    return undefined;
  }
  const fromLine = toLine((span as Record<string, unknown>).fromLine);
  const toLine_ = toLine((span as Record<string, unknown>).toLine);
  if (fromLine === undefined || toLine_ === undefined) {
    dlog("规范化", `「${title}」span 行号非法（fromLine/toLine 须为正整数）→ 忽略行范围`, true);
    return undefined;
  }
  return { fromLine, toLine: toLine_ };
}

/**
 * 解析可选 refs（引用锚）：每条须含非空 quote，最多 MAX_REFS 条，超限截断记日志；
 * quote 为空的引用锚丢弃记日志，不影响 Finding 本身。
 */
function parseRefs(item: Record<string, unknown>, title: string): FindingAnchor[] {
  const refs = item.refs;
  if (!Array.isArray(refs)) return [];
  const out: FindingAnchor[] = [];
  for (const r of refs) {
    if (out.length >= MAX_REFS) {
      dlog("规范化", `「${title}」引用锚超过 ${MAX_REFS} 条 → 截断多余引用`, true);
      break;
    }
    if (typeof r !== "object" || r === null) continue;
    const rec = r as Record<string, unknown>;
    const quote = cleanText(rec.quote);
    if (!quote) {
      dlog("规范化", `「${title}」引用锚 quote 为空 → 丢弃该引用（不影响 Finding）`, true);
      continue;
    }
    const lineHint = toLine(rec.lineHint);
    const hash = cleanText(rec.contentHash) || undefined;
    out.push({
      role: "ref",
      scope: "quote",
      quote,
      ...(lineHint !== undefined ? { lineHint } : {}),
      ...(hash !== undefined ? { contentHash: hash } : {}),
      anchorStatus: "unanchored",
    });
  }
  return out;
}

/**
 * 校验并规范化模型输出。必填：severity/title/quote/problem/reason/suggestion。
 * 空字段清理为空串剔除；quote 为空的 Finding 丢弃并记日志。
 */
export function normalizeFindings(
  raw: Array<Record<string, unknown>>,
  categoryId: string,
  nextId: () => string,
): NormalizedResult {
  const findings: Finding[] = [];
  let dropped = 0;
  for (const item of raw ?? []) {
    if (typeof item !== "object" || item === null) {
      dropped++;
      continue;
    }
    const title = cleanText(item.title);
    const quote = cleanText(item.quote);
    if (!quote) {
      dlog("规范化", `${categoryId}：「${title || "无标题"}」quote 为空 → 丢弃该 Finding`, true);
      dropped++;
      continue;
    }
    if (!title || !cleanText(item.problem) || !cleanText(item.reason) || !cleanText(item.suggestion)) {
      dlog("规范化", `${categoryId}：「${title || quote.slice(0, 12)}」缺少必填字段 → 丢弃该 Finding`, true);
      dropped++;
      continue;
    }
    const lineHintRaw = item.lineHint;
    const lineHint =
      (typeof lineHintRaw === "number" && Number.isFinite(lineHintRaw) ? Math.round(lineHintRaw) : undefined) ??
      (typeof lineHintRaw === "string" && lineHintRaw.trim() !== "" && Number.isFinite(Number(lineHintRaw))
        ? Math.round(Number(lineHintRaw))
        : undefined);
    const hash = cleanText(item.contentHash) || undefined;
    // span/refs → anchors（primary 恒在首位；refs 独立三信号，spec: finding-anchor-spans）
    const span = parseSpan(item, title);
    const refs = parseRefs(item, title);
    const primary: FindingAnchor = {
      role: "primary",
      scope: span ? "range" : "quote",
      quote,
      ...(lineHint && lineHint > 0 ? { lineHint } : {}),
      ...(hash !== undefined ? { contentHash: hash } : {}),
      ...(span ? { fromLine: span.fromLine, toLine: span.toLine } : {}),
      anchorStatus: "unanchored",
    };
    findings.push({
      id: nextId(),
      categoryId,
      severity: repairSeverity(item.severity, title),
      title,
      quote,
      lineHint: lineHint && lineHint > 0 ? lineHint : undefined,
      contentHash: hash,
      problem: cleanText(item.problem),
      reason: cleanText(item.reason),
      suggestion: cleanText(item.suggestion),
      anchorStatus: "unanchored",
      anchors: [primary, ...refs],
    });
  }
  return { findings, dropped };
}
