// Markdown → Block[]。翻译自 design/02 原型 parseBlocks（spec: document-parsing）。
// 空行分组 + 行号索引 + 稳定 ID；定位基准 = 行号 + 内容 + hash，审阅基于全文。

import type { BlockType, DocumentBlock } from "./types";

export function parseBlocks(text: string): DocumentBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const groups: { lines: string[]; line: number }[] = [];
  let cur: { lines: string[]; line: number } | null = null;
  lines.forEach((ln, i) => {
    if (ln.trim() === "") {
      cur = null;
      return;
    }
    if (!cur) {
      cur = { lines: [ln], line: i + 1 };
      groups.push(cur);
    } else {
      cur.lines.push(ln);
    }
  });
  return groups.map((g, idx) => {
    const raw = g.lines.join("\n");
    let type: BlockType = "paragraph";
    let plain = raw;
    if (/^#{1,6}\s/.test(raw)) {
      const m = raw.match(/^(#{1,6})\s+([\s\S]*)$/)!;
      type = `heading${m[1].length}` as BlockType;
      plain = m[2];
    } else if (/^```/.test(raw)) {
      type = "code";
      plain = raw.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
    } else if (/^>\s?/.test(raw)) {
      type = "quote";
      plain = raw.replace(/^>\s?/gm, "");
    } else if (/^([-*]|\d+\.)\s/.test(raw)) {
      type = "list_item";
      plain = raw.replace(/^([-*]|\d+\.)\s+/, "");
    }
    return {
      id: "block_" + String(idx + 1).padStart(3, "0"),
      type,
      rawText: raw,
      plainText: plain,
      order: idx,
      line: g.line,
    };
  });
}

/** 链接白名单：仅 http(s)/mailto。文档内容不可信，javascript:/data: 等 scheme 一律降级为纯文本。 */
export function isSafeLinkHref(href: string): boolean {
  return /^(?:https?:|mailto:)/i.test(href);
}

/** 行内 Markdown → HTML（code/strong/em/link），输出已转义；链接仅放行白名单 scheme。 */
export function inlineMd(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) =>
      isSafeLinkHref(href)
        ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : label,
    );
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
