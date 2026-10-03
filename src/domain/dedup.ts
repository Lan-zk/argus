// 同类去重（spec: finding-pipeline / PRD §38）。
// 仅同一 Category 内合并明显重复：quote 相同（归一化）+ 类型（标题）相同 + problem 高度相似。
// 跨 Category 永不合并。

import type { Finding } from "./types";
import { normText } from "./anchor";
import { dlog } from "./log";

/** 字符二元组相似度（Sørensen–Dice）。中文短句场景下简单稳健。 */
export function similarity(a: string, b: string): number {
  const A = normText(a);
  const B = normText(b);
  if (A === B) return 1;
  if (A.length < 2 || B.length < 2) return A === B ? 1 : 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < A.length - 1; i++) {
    const g = A.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let hit = 0;
  for (let i = 0; i < B.length - 1; i++) {
    const g = B.slice(i, i + 2);
    const c = grams.get(g) ?? 0;
    if (c > 0) {
      hit++;
      grams.set(g, c - 1);
    }
  }
  return (2 * hit) / (A.length - 1 + B.length - 1);
}

const PROBLEM_SIMILARITY_THRESHOLD = 0.72;

/**
 * 同类去重：保留先出现的一条，合并后续明显重复。
 * 去重判定 = quote 归一化相同 && 标题（去重类型）归一化相同 && problem 相似度 ≥ 阈值。
 */
export function dedupFindings(findings: Finding[], catName: string): Finding[] {
  const out: Finding[] = [];
  for (const f of findings) {
    const dup = out.find(
      (o) =>
        o.categoryId === f.categoryId &&
        normText(o.quote) === normText(f.quote) &&
        normText(o.title) === normText(f.title) &&
        similarity(o.problem, f.problem) >= PROBLEM_SIMILARITY_THRESHOLD,
    );
    if (dup) {
      dlog("去重", `${catName}：合并重复 Finding「${f.title}」（quote 相同 · 问题高度相似）`);
      continue;
    }
    out.push(f);
  }
  return out;
}
