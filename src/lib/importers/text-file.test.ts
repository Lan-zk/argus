// txt/md 直读归一（spec: document-import 提取与归一化——原样读取、仅做 BOM/换行归一）。
import { describe, expect, it } from "vitest";
import { extensionOf, IMPORT_EXTENSIONS, LEGACY_DOC_EXTENSIONS, normalizeTextFileContent } from "./text-file";

describe("normalizeTextFileContent", () => {
  it("剥离 UTF-8 BOM", () => {
    expect(normalizeTextFileContent("\uFEFF# 标题\n\n正文")).toBe("# 标题\n\n正文");
  });

  it("CRLF / CR 归一为 LF（块模型与行号契约的前提）", () => {
    expect(normalizeTextFileContent("第一行\r\n第二行\r第三行")).toBe("第一行\n第二行\n第三行");
  });

  it("正文内容原样保留，不做其他清洗", () => {
    const raw = "#  标题  \n\n>  引用\t原文\n- 列表项  ";
    expect(normalizeTextFileContent(raw)).toBe(raw);
  });

  it("无 BOM 的文本不受影响", () => {
    expect(normalizeTextFileContent("abc")).toBe("abc");
  });
});

describe("扩展名判定", () => {
  it("大小写不敏感", () => {
    expect(extensionOf("报告.PDF")).toBe("pdf");
    expect(extensionOf("Draft.DOCX")).toBe("docx");
  });

  it("无扩展名返回空串", () => {
    expect(extensionOf("README")).toBe("");
  });

  it("支持列表覆盖四格式 + 旧版 .doc（为给出指引）", () => {
    expect([...IMPORT_EXTENSIONS]).toEqual(["txt", "md", "docx", "pdf", "doc"]);
    expect([...LEGACY_DOC_EXTENSIONS]).toEqual(["doc"]);
  });
});
