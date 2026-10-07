// docx 提取（spec: document-import 提取与归一化）：正文文字无丢失 + 块类型映射正确 +
// 提取产物满足 parseBlocks 块模型与行号契约（tasks 2.1 / 2.2）。
import { describe, expect, it } from "vitest";
import { docxHtmlToMarkdownish, extractDocxText } from "./docx";
import { parseBlocks } from "../../domain/parser";

// vitest（happy-dom）无 node:fs / vite 资产通道，fixture 以 base64 模块内嵌
import sampleDocxB64 from "./fixtures/sample.docx.base64";

const sampleDocx = (): ArrayBuffer => {
  const bin = atob(sampleDocxB64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
};

describe("docxHtmlToMarkdownish（纯映射）", () => {
  it("标题/段落/列表/引用/代码/表格映射为 Markdown 风格", () => {
    const html = [
      "<h1>大标题</h1>",
      "<p>正文段落。</p>",
      "<ul><li>要点一</li><li>要点二</li></ul>",
      "<ol><li>步骤一</li><li>步骤二</li></ol>",
      "<blockquote><p>引用内容。</p></blockquote>",
      "<pre><code>let a = 2;</code></pre>",
      "<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>",
    ].join("");
    const out = docxHtmlToMarkdownish(html);
    expect(out).toContain("# 大标题");
    expect(out).toContain("正文段落。");
    expect(out).toContain("- 要点一\n- 要点二");
    expect(out).toContain("1. 步骤一\n2. 步骤二");
    expect(out).toContain("> 引用内容。");
    expect(out).toContain("```\nlet a = 2;\n```");
    expect(out).toContain("A | B\nC | D");
  });

  it("嵌套列表缩进一层", () => {
    const html = "<ul><li>父项<ul><li>子项</li></ul></li></ul>";
    const out = docxHtmlToMarkdownish(html);
    expect(out).toContain("- 父项\n  - 子项");
  });

  it("空段落与纯空白块被过滤", () => {
    expect(docxHtmlToMarkdownish("<p></p><p>   </p><p>保留</p>")).toBe("保留\n");
  });
});

describe("extractDocxText（真实 docx 样本）", () => {
  it("正文文字无丢失（spec: 提取 MUST NOT 静默丢弃正文文字内容）", async () => {
    const text = await extractDocxText(sampleDocx());
    for (const piece of [
      "季度报告审阅样本",
      "这是第一段正文，包含加粗与斜体文字。",
      "第二章 结构说明",
      "第二段正文说明文档结构。",
      "第一项要点",
      "第二项要点",
      "引用段落：引用原文的批注样本。",
      "const x = 1;",
      "列一 | 列二",
      "数据甲 | 数据乙",
      "结尾正文段落。",
    ]) {
      expect(text).toContain(piece);
    }
  });

  it("结构标记保留：标题 # / 引用 > / 列表 - / 代码围栏", async () => {
    const text = await extractDocxText(sampleDocx());
    expect(text).toContain("# 季度报告审阅样本");
    expect(text).toContain("## 第二章 结构说明");
    expect(text).toContain("> 引用段落");
    expect(text).toContain("- 第一项要点");
    expect(text).toContain("```");
  });
});

describe("提取产物过 parseBlocks（tasks 2.2 块模型与行号契约）", () => {
  it("标题归 heading、引用归 quote、列表归 list_item、代码归 code", async () => {
    const text = await extractDocxText(sampleDocx());
    const blocks = parseBlocks(text);
    const byType = (t: string) => blocks.filter((b) => b.type === t);

    expect(byType("heading1").map((b) => b.plainText)).toEqual(["季度报告审阅样本"]);
    expect(byType("heading2").map((b) => b.plainText)).toEqual(["第二章 结构说明"]);
    expect(byType("quote").length).toBe(1);
    expect(byType("quote")[0].plainText).toContain("引用原文的批注样本");
    expect(byType("list_item").length).toBe(1); // 连续列表行 = 单块（既有分块语义）
    expect(byType("list_item")[0].plainText).toContain("第一项要点");
    expect(byType("code").length).toBe(1);
    expect(byType("code")[0].plainText).toContain("const x = 1;");
    // 表格降级为段落文本行：内容仍在（结构降级、文字不丢）
    expect(blocks.some((b) => b.plainText.includes("列一 | 列二"))).toBe(true);
  });

  it("行号契约：line 为 1 起始行号且与原文行对齐（锚定基准）", async () => {
    const text = await extractDocxText(sampleDocx());
    const lines = text.split("\n");
    for (const b of parseBlocks(text)) {
      expect(lines[b.line - 1]).toBe(b.rawText.split("\n")[0]);
    }
    expect(parseBlocks(text)[0].line).toBe(1);
  });
});
