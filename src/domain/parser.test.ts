// spec: document-parsing 全部场景
import { describe, expect, it } from "vitest";
import { parseBlocks } from "./parser";

describe("parseBlocks 基本元素识别", () => {
  it("标题/粗斜体/列表/引用/链接解析不中断", () => {
    const text = [
      "# 大标题",
      "",
      "## 二级标题",
      "",
      "普通段落 **粗体** 与 *斜体* 以及 [链接](https://example.com)。",
      "",
      "- 无序项",
      "- 无序项二",
      "",
      "1. 有序项",
      "",
      "> 引用一行",
      "> 引用两行",
    ].join("\n");
    const blocks = parseBlocks(text);
    // 连续的非空行归入同一块：两个无序项同块、引用两行同块
    expect(blocks.map((b) => b.type)).toEqual([
      "heading1",
      "heading2",
      "paragraph",
      "list_item",
      "list_item",
      "quote",
    ]);
    expect(blocks[3].rawText).toBe("- 无序项\n- 无序项二");
    expect(blocks[5].plainText).toBe("引用一行\n引用两行");
  });

  it("代码块识别：rawText 与 plainText 原样保留代码", () => {
    const text = "```ts\nconst a = 1;\nconst b = 2;\n```";
    const blocks = parseBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("code");
    expect(blocks[0].plainText).toBe("const a = 1;\nconst b = 2;");
    expect(blocks[0].rawText).toBe(text);
  });

  it("不支持的语法归入段落/other 但不中断解析、不丢弃文本", () => {
    const text = "| 表格 | 语法 |\n|---|---|\n\n普通文字 ~~删除线~~";
    const blocks = parseBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].rawText).toContain("表格");
    expect(blocks[1].plainText).toBe("普通文字 ~~删除线~~");
  });

  it("空行分组：空行两侧分属不同块；连续非空行同块", () => {
    const text = "第一段第一行\n第一段第二行\n\n\n\n第二段";
    const blocks = parseBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].rawText).toBe("第一段第一行\n第一段第二行");
    expect(blocks[1].rawText).toBe("第二段");
  });
});

describe("行号索引", () => {
  it("起始行号与源文本行严格一致（从 1 开始）", () => {
    const text = ["l1", "", "l3", "l4", "", "", "l7"].join("\n");
    const blocks = parseBlocks(text);
    expect(blocks[0].line).toBe(1);
    expect(blocks[1].line).toBe(3);
    expect(blocks[2].line).toBe(7);
  });

  it("第 19 行起始的段落块行号为 19", () => {
    const text = [...Array(17).fill("x"), "", "第 19 行段落"].join("\n");
    const blocks = parseBlocks(text);
    expect(blocks[blocks.length - 1].line).toBe(19);
  });

  it("稳定 ID 与 order：block_001 顺序编号", () => {
    const blocks = parseBlocks("a\n\nb\n\nc");
    expect(blocks.map((b) => b.id)).toEqual(["block_001", "block_002", "block_003"]);
    expect(blocks.map((b) => b.order)).toEqual([0, 1, 2]);
  });

  it("CRLF 换行不影响解析", () => {
    const blocks = parseBlocks("a\r\n\r\nb");
    expect(blocks).toHaveLength(2);
  });
});
