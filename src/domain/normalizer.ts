// Finding 规范化（spec: finding-pipeline）。应用侧校验，不依赖 Prompt。
// 必填字段校验、空字段清理、非法 severity 修复、空 quote 丢弃并记日志。

import type { Finding, Severity } from "./types";
import { dlog } from "./log";

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
    });
  }
  return { findings, dropped };
}
