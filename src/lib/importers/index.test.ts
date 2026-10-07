// 导入编排（spec: document-import 支持格式与排除项 / 提取与归一化）：
// mock 文件选择，覆盖格式分流、排除指引与取消语义。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { importDocument, ImportUnsupportedError } from "./index";
import type { PickedFile } from "./pick";

vi.mock("./pick", () => ({ pickImportFile: vi.fn() }));
vi.mock("./docx", () => ({ extractDocxText: vi.fn().mockResolvedValue("# 标题\n\ndocx 正文") }));
vi.mock("./pdf", () => ({ extractPdfText: vi.fn().mockResolvedValue("pdf 正文\n") }));
// worker 资产 ?url 导入在本测试环境无意义，隔离真实模块副作用
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/assets/pdf.worker.js" }));

import { pickImportFile } from "./pick";

const file = (name: string, over: Partial<PickedFile> = {}): PickedFile => ({
  name,
  ext: name.includes(".") ? name.split(".").pop()!.toLowerCase() : "",
  readText: async () => `raw-${name}`,
  readBytes: async () => new ArrayBuffer(8),
  ...over,
});

beforeEach(() => {
  vi.mocked(pickImportFile).mockReset();
});

describe("importDocument 格式分流", () => {
  it("txt：BOM/换行归一后原样进入", async () => {
    vi.mocked(pickImportFile).mockResolvedValue(file("笔记.txt", { readText: async () => "\uFEFF第一行\r\n第二行" }));
    const r = await importDocument();
    expect(r).toMatchObject({ kind: "txt", filename: "笔记.txt" });
    expect(r!.text).toBe("第一行\n第二行");
  });

  it("md：kind 为 md", async () => {
    vi.mocked(pickImportFile).mockResolvedValue(file("稿.md"));
    expect((await importDocument())!.kind).toBe("md");
  });

  it("docx：二进制交提取器", async () => {
    vi.mocked(pickImportFile).mockResolvedValue(file("报告.docx"));
    const r = await importDocument();
    expect(r!.kind).toBe("docx");
    expect(r!.text).toContain("docx 正文");
  });

  it("pdf：二进制交提取器（含 workerUrl）", async () => {
    const { extractPdfText } = await import("./pdf");
    vi.mocked(pickImportFile).mockResolvedValue(file("手稿.pdf"));
    const r = await importDocument();
    expect(r!.kind).toBe("pdf");
    expect(extractPdfText).toHaveBeenCalledWith(expect.any(ArrayBuffer), { workerUrl: "/assets/pdf.worker.js" });
  });

  it("记录 filename 与 importedAt（ISO 时间）", async () => {
    vi.mocked(pickImportFile).mockResolvedValue(file("a.txt"));
    const r = await importDocument();
    expect(r!.filename).toBe("a.txt");
    expect(!Number.isNaN(Date.parse(r!.importedAt))).toBe(true);
  });
});

describe("importDocument 排除与取消", () => {
  it("旧版 .doc：给出「另存为 .docx」指引，不进入解析", async () => {
    vi.mocked(pickImportFile).mockResolvedValue(file("旧文档.doc"));
    await expect(importDocument()).rejects.toBeInstanceOf(ImportUnsupportedError);
    await expect(importDocument()).rejects.toThrow(/另存为 \.docx/);
  });

  it("未识别扩展名：列出支持格式", async () => {
    vi.mocked(pickImportFile).mockResolvedValue(file("数据.xlsx"));
    await expect(importDocument()).rejects.toThrow(/txt \/ md \/ docx \/ pdf/);
  });

  it("用户取消选择框 → null（无任何状态变化）", async () => {
    vi.mocked(pickImportFile).mockResolvedValue(null);
    expect(await importDocument()).toBeNull();
  });
});
