// 共享文本归一化（review-versioning design D5：parser / prompts / anchor / rounddiff 必须同一实现，
// 否则 diff 噪声污染跨轮对比）。此前散落三处的逻辑收拢于此，anchor.ts 向后兼容再导出。

/** 换行归一：CRLF / CR → LF（parser 与提示词行号前缀共用，保证 L{n}| 与块行号一致）。 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** 去除全部空白字符（anchor 内容匹配与 contentHash 的基础归一）。 */
export function normText(s: string): string {
  return s.replace(/\s+/g, "");
}

/** 归一化文本 + 归一化位置 → 原文偏移的映射表（anchor 定位用）。 */
export function normMap(raw: string): { n: string; map: number[] } {
  let n = "";
  const map: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (!/\s/.test(raw[i])) {
      n += raw[i];
      map.push(i);
    }
  }
  return { n, map };
}
