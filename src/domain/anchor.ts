// 三信号定位：内容匹配 → 行号消歧 → hash 校验（spec: finding-pipeline）。
// 翻译自 design/02 原型 anchorOne / normText / hashText / normMap，任何单一信号不独立信任。

import type { DocumentBlock, Finding } from "./types";
import { dlog } from "./log";

/** 归一化：去除全部空白字符。 */
export function normText(s: string): string {
  return s.replace(/\s+/g, "");
}

/** djb2 变换取 8 位 hex，与原型 hashText 一致；输入先归一化。 */
export function hashText(s: string): string {
  let h = 5381;
  const t = normText(s);
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** 归一化文本 + 归一化位置 → 原文偏移的映射表。 */
function normMap(raw: string): { n: string; map: number[] } {
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

export interface AnchorInput {
  id: string;
  categoryId: string;
  severity: Finding["severity"];
  title: string;
  quote: string;
  lineHint?: number;
  contentHash?: string;
  problem: string;
  reason: string;
  suggestion: string;
}

/** 单条 quote 的候选命中上限：畸形输入（重复文本刷屏）时截断，防止 CPU 放大拖死 UI。 */
const MAX_CANDIDATES = 200;

/**
 * 对一条 Finding 执行三步定位，写入 blockId / startOffset / endOffset / line。
 * 内容无命中时保留为 unanchored（右侧显示、左侧不高亮）。
 */
export function anchorOne(f: AnchorInput, blocks: DocumentBlock[], catName: string): Finding {
  const out: Finding = {
    ...f,
    contentHash: f.contentHash ?? hashText(f.quote),
    anchorStatus: "unanchored",
    line: undefined,
    blockId: undefined,
    startOffset: undefined,
    endOffset: undefined,
  };
  const hq = normText(f.quote);
  if (!hq) return out;

  // 候选的精确命中行 = 块起始行 + 块内换行数（同块多命中时行号消歧才有效）
  const lineOf = (b: DocumentBlock, s: number) => b.line + (b.plainText.slice(0, s).match(/\n/g) || []).length;

  // ① 内容匹配：quote 归一化后在全文范围收集候选（忽略空白差异，候选数有上限）
  const cands: { b: DocumentBlock; s: number; e: number; line: number }[] = [];
  for (const b of blocks) {
    if (cands.length >= MAX_CANDIDATES) break;
    const { n, map } = normMap(b.plainText);
    let k = n.indexOf(hq);
    while (k !== -1) {
      const s = map[k];
      const e = map[k + hq.length - 1] + 1;
      cands.push({ b, s, e, line: lineOf(b, s) });
      if (cands.length >= MAX_CANDIDATES) break;
      k = n.indexOf(hq, k + 1);
    }
  }
  if (!cands.length) {
    dlog(
      "锚定",
      `${catName}：「${f.title}」内容在全文未命中 → 保留为 unanchored（右侧显示 / 左侧不高亮）`,
      true,
    );
    return out;
  }

  // ② 行号消歧：唯一候选直接采用；多候选取与 lineHint 最接近的命中行
  let c = cands[0];
  if (cands.length > 1) {
    c = cands.reduce((a, x) =>
      Math.abs(x.line - (f.lineHint || 0)) < Math.abs(a.line - (f.lineHint || 0)) ? x : a,
    );
    dlog(
      "锚定",
      `${catName}：「${f.title}」quote 命中 ${cands.length} 处 → 按行号提示 L${f.lineHint ?? "—"} 消歧，定位至 L${c.line}`,
    );
  } else if (f.lineHint && f.lineHint !== c.line) {
    dlog(
      "锚定",
      `${catName}：「${f.title}」行号提示 L${f.lineHint} 与命中行不符 → 以内容匹配为准，定位至 L${c.line}`,
    );
  }

  // ③ hash 校验：不一致以内容匹配为准并记录日志
  const realHash = hashText(c.b.plainText.slice(c.s, c.e));
  if (realHash !== out.contentHash) {
    dlog(
      "锚定",
      `${catName}：「${f.title}」hash 不一致（${realHash} ≠ ${out.contentHash}）→ 仍以内容匹配为准`,
      true,
    );
  }
  out.blockId = c.b.id;
  out.startOffset = c.s;
  out.endOffset = c.e;
  out.line = c.line;
  out.anchorStatus = "anchored";
  return out;
}
