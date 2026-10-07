// docx 提取（spec: document-import 提取与归一化）。
// mammoth（浏览器构建）docx → HTML → 「Markdown 风格文本」：标题 #、引用 >、代码围栏、
// 表格降级为「单元格 | 单元格」文本行。映射目标是让既有 parseBlocks 能识别块类型
// （标题归 heading、引用归 quote、列表归 list_item、代码归 code）；正文文字 MUST NOT 丢失，
// 结构降级由预览确认步兜底。

/**
 * docx 样式名 → HTML 的补充映射（mammoth 内置覆盖标题/列表/表格，引用与代码块需显式映射；
 * Quote 实测不在内置 map 中——不映射会被降级为普通段落）。
 */
const MAMMOTH_STYLE_MAP = [
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Code'] => pre:fresh",
  "p[style-name='代码'] => pre:fresh",
];

/**
 * mammoth 输出的 HTML → Markdown 风格文本（纯函数，供单测直接覆盖）。
 * 块级映射：h1-h6 → `#`×n、p → 段落、ul/ol li → `- ` / `1. `、blockquote → `> `、
 * pre → ``` 围栏、table → 每行「单元格 | 单元格」；行内样式（加粗等）降级为纯文字。
 */
export function docxHtmlToMarkdownish(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks: string[] = [];

  const pushBlock = (s: string) => {
    const t = s.replace(/\n{3,}/g, "\n\n").trim();
    if (t) blocks.push(t);
  };

  const renderList = (el: Element, ordered: boolean): string => {
    const lines: string[] = [];
    let n = 1;
    for (const li of Array.from(el.children)) {
      if (li.tagName.toLowerCase() !== "li") continue;
      // li 内嵌套列表：先取直接文字，再递归子列表（缩进一层）
      const nested = Array.from(li.children).filter((c) => /^(ul|ol)$/i.test(c.tagName));
      const clone = li.cloneNode(true) as Element;
      for (const c of Array.from(clone.children)) {
        if (/^(ul|ol)$/i.test(c.tagName)) c.remove();
      }
      const text = (clone.textContent ?? "").replace(/\s+/g, " ").trim();
      lines.push(ordered ? `${n++}. ${text}` : `- ${text}`);
      for (const sub of nested) {
        for (const line of renderList(sub, sub.tagName.toLowerCase() === "ol").split("\n")) {
          if (line) lines.push("  " + line);
        }
      }
    }
    return lines.join("\n");
  };

  const walk = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      pushBlock("#".repeat(Number(tag[1])) + " " + (el.textContent ?? "").trim());
    } else if (tag === "p") {
      pushBlock((el.textContent ?? "").replace(/\s+/g, " ").trim());
    } else if (tag === "pre") {
      pushBlock("```\n" + (el.textContent ?? "").replace(/\s+$/, "") + "\n```");
    } else if (tag === "blockquote") {
      // mammoth 的 blockquote 内含 p；整体文字按行加 `> `
      const inner = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      pushBlock("> " + inner);
    } else if (tag === "ul" || tag === "ol") {
      pushBlock(renderList(el, tag === "ol"));
    } else if (tag === "table") {
      const rows: string[] = [];
      for (const tr of Array.from(el.querySelectorAll("tr"))) {
        const cells = Array.from(tr.children).map((td) => (td.textContent ?? "").replace(/\s+/g, " ").trim());
        if (cells.some((c) => c !== "")) rows.push(cells.join(" | "));
      }
      pushBlock(rows.join("\n"));
    } else {
      // 未知块级元素：递归取内容，保证文字不丢
      for (const child of Array.from(el.children)) walk(child);
      if (el.children.length === 0) pushBlock((el.textContent ?? "").trim());
    }
  };

  for (const child of Array.from(doc.body.children)) walk(child);
  // mammoth 会把空段落输出为 <p></p>——上面已过滤空块；块间以空行分隔（parseBlocks 分组契约）
  return blocks.join("\n\n") + "\n";
}

/** docx 二进制 → Markdown 风格文本。mammoth 动态加载（仅导入时加载，首屏体积不变）。 */
export async function extractDocxText(data: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: data }, { styleMap: MAMMOTH_STYLE_MAP });
  return docxHtmlToMarkdownish(html);
}
