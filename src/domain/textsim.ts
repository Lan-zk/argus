// 跨轮对比的文本相似度（review-versioning design D5）：
// bigram（二元字符）Dice 系数 + 句窗最佳匹配。确定性、零依赖、不引入 embedding。
// 阈值为 spike 结论（真实文档三粒度样本：改词 / 改句 / 挪段调参），集中定义便于迭代。

import { normText } from "./normalize";

/** bigram Dice 相似度 ∈ [0,1]；空串返回 0。 */
export function bigramSimilarity(a: string, b: string): number {
  const x = normText(a);
  const y = normText(b);
  if (x.length < 2 || y.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let hit = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const c = grams.get(g) ?? 0;
    if (c > 0) {
      hit++;
      grams.set(g, c - 1);
    }
  }
  return (2 * hit) / (x.length - 1 + y.length - 1);
}

export interface WindowMatch {
  best: number;
  /** 最佳匹配窗口起始行（curr 文档行号，1 基）；无任何窗口返回 null。 */
  line: number | null;
}

/**
 * 句窗最佳匹配：把 curr 全文按句（。！？.!? 换行）切分，滑 1–3 句窗口与 quote 比 bigram。
 * 供 L1「待确认」判定与 L2 位置邻近度使用。文本 ≤ 数百句时性能可控（30k 上限内）。
 */
export function bestWindowMatch(quote: string, currText: string): WindowMatch {
  const sentences: { text: string; line: number }[] = [];
  let line = 1;
  let buf = "";
  const flush = () => {
    if (buf.trim()) sentences.push({ text: buf, line });
    buf = "";
  };
  for (const ch of currText) {
    if (ch === "\n") {
      flush();
      line++;
      continue;
    }
    buf += ch;
    if ("。！？!?.;；".includes(ch)) flush();
  }
  flush();
  let best = 0;
  let bestLine: number | null = null;
  for (let i = 0; i < sentences.length; i++) {
    let acc = "";
    for (let w = 0; w < 3 && i + w < sentences.length; w++) {
      acc += sentences[i + w].text;
      const score = bigramSimilarity(quote, acc);
      if (score > best) {
        best = score;
        bestLine = sentences[i].line;
      }
    }
  }
  return { best: bestLine === null ? 0 : best, line: bestLine };
}
