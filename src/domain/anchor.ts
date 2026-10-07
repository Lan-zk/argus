// 三信号定位：内容匹配 → 行号消歧 → hash 校验（spec: finding-pipeline）。
// 翻译自 design/02 原型 anchorOne / normText / hashText / normMap，任何单一信号不独立信任。
// spec: finding-anchor-spans —— 定位按「锚」执行：一条 Finding = 1 主锚（句级或行范围）
// + 至多 2 引用锚（句级），逐锚独立三信号验证；主锚失败整条 unanchored，引用锚失败不连累。

import type { DocumentBlock, Finding, FindingAnchor } from "./types";
import { dlog } from "./log";
import { normText, normMap } from "./normalize";

export { normText }; // 向后兼容：既有调用方从 anchor 导入

/** 行范围防滥用上限（spec：行范围超过文档总行数一半或超过 120 行时收敛到代表句所在块）。 */
export const RANGE_MAX_LINES = 120;

/** djb2 变换取 8 位 hex，与原型 hashText 一致；输入先归一化。 */
export function hashText(s: string): string {
  let h = 5381;
  const t = normText(s);
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
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

/** 块的结束行号（块可含多个物理行）。 */
export function blockEndLine(b: DocumentBlock): number {
  return b.line + (b.plainText.match(/\n/g) || []).length;
}

/** 三信号核心：单条 quote 在全文内的定位（内容匹配 + 行号消歧 + hash 校验），无命中返回 null。 */
function locateQuote(
  quote: string,
  lineHint: number | undefined,
  contentHash: string | undefined,
  blocks: DocumentBlock[],
  label: string,
): { b: DocumentBlock; s: number; e: number; line: number } | null {
  const hq = normText(quote);
  if (!hq) return null;

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
  if (!cands.length) return null;

  // ② 行号消歧：唯一候选直接采用；多候选取与 lineHint 最接近的命中行
  let c = cands[0];
  if (cands.length > 1) {
    c = cands.reduce((a, x) =>
      Math.abs(x.line - (lineHint || 0)) < Math.abs(a.line - (lineHint || 0)) ? x : a,
    );
    dlog("锚定", `${label}：quote 命中 ${cands.length} 处 → 按行号提示 L${lineHint ?? "—"} 消歧，定位至 L${c.line}`);
  } else if (lineHint && lineHint !== c.line) {
    dlog("锚定", `${label}：行号提示 L${lineHint} 与命中行不符 → 以内容匹配为准，定位至 L${c.line}`);
  }

  // ③ hash 校验：不一致以内容匹配为准并记录日志
  const realHash = hashText(c.b.plainText.slice(c.s, c.e));
  if (contentHash && realHash !== contentHash) {
    dlog("锚定", `${label}：hash 不一致（${realHash} ≠ ${contentHash}）→ 仍以内容匹配为准`, true);
  }
  return c;
}

/** 引用锚句级定位：无命中仅标记该引用未定位，不影响主锚（spec: 未定位 Finding）。 */
function locateRef(a: FindingAnchor, blocks: DocumentBlock[], label: string): FindingAnchor {
  const hit = locateQuote(a.quote, a.lineHint, a.contentHash, blocks, label);
  if (!hit) {
    dlog("锚定", `${label}：引用锚 quote 在全文未命中 → 标记该引用未定位（不影响主批注）`, true);
    return { ...a, anchorStatus: "unanchored" };
  }
  return {
    ...a,
    blockId: hit.b.id,
    startOffset: hit.s,
    endOffset: hit.e,
    line: hit.line,
    anchorStatus: "anchored",
  };
}

/** 主锚定位：句级走三信号；行范围先句级命中代表句，再互验/收敛范围并计算覆盖块区间。 */
function locatePrimary(a: FindingAnchor, blocks: DocumentBlock[], label: string): FindingAnchor {
  const totalLines = blocks.length ? blockEndLine(blocks[blocks.length - 1]) : 0;
  const hit = locateQuote(a.quote, a.lineHint, a.contentHash, blocks, label);
  if (!hit) {
    dlog("锚定", `${label}：内容在全文未命中 → 保留为 unanchored（右侧显示 / 左侧不高亮）`, true);
    return { ...a, anchorStatus: "unanchored" };
  }

  if (a.scope !== "range") {
    return {
      ...a,
      blockId: hit.b.id,
      startOffset: hit.s,
      endOffset: hit.e,
      line: hit.line,
      anchorStatus: "anchored",
    };
  }

  // 行范围主锚：先钳到文档边界，再做互验与防滥用收敛（spec: 行范围与代表句互验）
  let fromLine = Math.max(1, Math.min(a.fromLine ?? hit.line, totalLines || 1));
  let toLine = Math.max(1, Math.min(a.toLine ?? hit.line, totalLines || 1));
  if (fromLine > toLine) [fromLine, toLine] = [toLine, fromLine];

  const hitFrom = hit.b.line;
  const hitTo = blockEndLine(hit.b);
  if (toLine - fromLine + 1 > RANGE_MAX_LINES || toLine - fromLine + 1 > Math.ceil(totalLines / 2)) {
    dlog(
      "锚定",
      `${label}：行范围 L${fromLine}–L${toLine} 过大（文档 ${totalLines} 行）→ 收敛为代表句所在块 L${hitFrom}–L${hitTo}`,
      true,
    );
    fromLine = hitFrom;
    toLine = hitTo;
  } else if (hit.line < fromLine || hit.line > toLine) {
    dlog(
      "锚定",
      `${label}：代表句命中 L${hit.line} 不在所报范围 L${fromLine}–L${toLine} 内 → 以内容命中为准，范围收敛为代表句所在块`,
      true,
    );
    fromLine = hitFrom;
    toLine = hitTo;
  }

  // 覆盖块区间：与 [fromLine, toLine] 相交的全部块；blockId = 首个覆盖块（滚动定位用）
  const covers = blocks.filter((b) => b.line <= toLine && blockEndLine(b) >= fromLine);
  return {
    ...a,
    blockId: covers[0]?.id ?? hit.b.id,
    startOffset: undefined,
    endOffset: undefined,
    line: hit.line,
    fromLine,
    toLine,
    anchorStatus: "anchored",
  };
}

/**
 * 多锚定位入口（orchestrator 调用）：逐锚定位 → 以主锚决定整条 Finding 状态 →
 * 同步顶层投影字段（quote/line/blockId/offsets/anchorStatus ≡ primary 锚）。
 */
export function anchorFinding(f: Finding, blocks: DocumentBlock[], catName: string): Finding {
  const label = `${catName}：「${f.title}」`;
  const anchors = f.anchors.map((a) =>
    a.role === "primary" ? locatePrimary(a, blocks, label) : locateRef(a, blocks, `${label}（引用）`),
  );
  const primary = anchors.find((a) => a.role === "primary") ?? anchors[0];
  return syncProjection({ ...f, anchors }, primary);
}

/** 取 Finding 的主锚（anchors 中 role=primary 的首元素；异常形态回退首元素）。 */
export function primaryAnchorOf(f: Finding): FindingAnchor | undefined {
  return f.anchors.find((a) => a.role === "primary") ?? f.anchors[0];
}

/** 顶层字段 = 主锚只读投影（兼容既有读取方与旧版本落库列；spec: finding-anchor-spans D2）。 */
export function syncProjection(f: Finding, primary: FindingAnchor | undefined): Finding {
  const p = primary ?? f.anchors.find((a) => a.role === "primary");
  if (!p) return f;
  return {
    ...f,
    quote: p.quote,
    lineHint: p.lineHint,
    contentHash: p.contentHash,
    line: p.line,
    blockId: p.blockId,
    startOffset: p.startOffset,
    endOffset: p.endOffset,
    anchorStatus: p.anchorStatus,
  };
}

/** 旧数据/旧构造路径兜底：无 anchors 的 Finding 合成单主锚（句级）形态。 */
export function withAnchors(f: Omit<Finding, "anchors">): Finding {
  return {
    ...f,
    anchors: [
      {
        role: "primary",
        scope: "quote",
        quote: f.quote,
        ...(f.lineHint !== undefined ? { lineHint: f.lineHint } : {}),
        ...(f.contentHash !== undefined ? { contentHash: f.contentHash } : {}),
        ...(f.line !== undefined ? { line: f.line } : {}),
        ...(f.blockId !== undefined ? { blockId: f.blockId } : {}),
        ...(f.startOffset !== undefined ? { startOffset: f.startOffset } : {}),
        ...(f.endOffset !== undefined ? { endOffset: f.endOffset } : {}),
        anchorStatus: f.anchorStatus,
      },
    ],
  };
}

/**
 * 对一条 Finding 执行三步定位，写入 blockId / startOffset / endOffset / line。
 * 内容无命中时保留为 unanchored（右侧显示、左侧不高亮）。
 * 句级单锚兼容入口（历史调用方/测试）；多锚走 anchorFinding。
 */
export function anchorOne(f: AnchorInput, blocks: DocumentBlock[], catName: string): Finding {
  return anchorFinding(withAnchors({ ...f, anchorStatus: "unanchored" as const }), blocks, catName);
}
