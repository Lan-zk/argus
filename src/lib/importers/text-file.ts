// txt/md 文件直读归一（spec: document-import 提取与归一化）。
// txt/md 原样读取：仅做 BOM 剥离与换行归一，其余交给既有解析管线。

import { normalizeNewlines } from "../../domain/normalize";

/** BOM（U+FEFF）剥离 + CRLF/CR → LF。UTF-8 BOM 是 Windows 记事本常见残留。 */
export function normalizeTextFileContent(raw: string): string {
  return normalizeNewlines(raw.replace(/^\uFEFF/, ""));
}

/** 支持导入的文件扩展名（含 .doc：让用户能选中它，再给出「另存为 .docx」指引）。 */
export const IMPORT_EXTENSIONS = ["txt", "md", "docx", "pdf", "doc"] as const;

/** 旧版 Word 二进制格式：明确排除，不进入解析（spec: 支持格式与排除项）。 */
export const LEGACY_DOC_EXTENSIONS = ["doc"] as const;

/** 文件名 → 小写扩展名（无扩展名返回空串）。 */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}
