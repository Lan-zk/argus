// 跨轮块级 diff 与位置映射（review-versioning design D5）。
// 基于 diff（jsdiff）行级 LCS：产出 prev 行 → curr 行映射表（含“变更/删除”空映射），
// 供 L2 疑似遗留的位置邻近度计算；L1 的文本判定不依赖映射（全局匹配）。

import { diffArrays } from "diff";
import { normalizeNewlines } from "./normalize";

export interface RoundDiff {
  /** prev 1 基行号 → curr 1 基行号（行原样保留时）；被删/改写为 null。 */
  lineMap: Map<number, number>;
  /** curr 中发生变更（增/改）的行号集合（1 基）。 */
  changedCurrLines: Set<number>;
}

export function buildLineDiff(prevText: string, currText: string): RoundDiff {
  const prevLines = normalizeNewlines(prevText).split("\n");
  const currLines = normalizeNewlines(currText).split("\n");
  const parts = diffArrays(prevLines, currLines);
  const lineMap = new Map<number, number>();
  const changedCurrLines = new Set<number>();
  let pi = 1;
  let ci = 1;
  for (const part of parts) {
    const count = part.count ?? part.value.length;
    if (part.added) {
      for (let k = 0; k < count; k++) changedCurrLines.add(ci + k);
      ci += count;
    } else if (part.removed) {
      for (let k = 0; k < count; k++) lineMap.set(pi + k, null as unknown as number);
      pi += count;
    } else {
      for (let k = 0; k < count; k++) lineMap.set(pi + k, ci + k);
      pi += count;
      ci += count;
    }
  }
  return { lineMap, changedCurrLines };
}

/** prev 行映射到 curr 后与 curr 行的距离（同处 ≈ 0）；不可映射返回 null。 */
export function mappedDistance(diff: RoundDiff, prevLine: number, currLine: number): number | null {
  const mapped = diff.lineMap.get(prevLine);
  if (mapped == null) return null;
  return Math.abs(mapped - currLine);
}
