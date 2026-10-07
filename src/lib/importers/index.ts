// 文档导入编排（spec: document-import 支持格式与排除项 / 提取与归一化）。
// 选择 → 扩展名判定与排除指引 → 按格式提取 → 统一纯文本（汇入既有 parseBlocks 管线）。
// mammoth / pdfjs 均动态 import：仅在用户触发导入时加载，首屏体积不变。

import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { extractDocxText } from "./docx";
import { extractPdfText } from "./pdf";
import { pickImportFile } from "./pick";
import { normalizeTextFileContent } from "./text-file";

/** 可导入的文件格式（ImportSource 的导入分支 kind 值域）。 */
export type ImportFileKind = "txt" | "md" | "docx" | "pdf";

export interface ImportResult {
  kind: ImportFileKind;
  filename: string;
  /** 提取后的最终文本（进入预览确认步，确认后写入输入区）。 */
  text: string;
  importedAt: string;
}

/** 不支持的格式/文件形态：给出可行动指引，不做静默降级（spec: 支持格式与排除项）。 */
export class ImportUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportUnsupportedError";
  }
}

/**
 * 导入一份文档：返回 null = 用户在选择框取消（无任何状态变化）。
 * 旧版 .doc / 扫描件 pdf / 未识别扩展名抛 ImportUnsupportedError（含指引文案）。
 */
export async function importDocument(): Promise<ImportResult | null> {
  const file = await pickImportFile();
  if (!file) return null;
  const importedAt = new Date().toISOString();
  const base = { filename: file.name, importedAt };
  switch (file.ext) {
    case "txt":
    case "md":
      return { ...base, kind: file.ext, text: normalizeTextFileContent(await file.readText()) };
    case "docx":
      return { ...base, kind: "docx", text: await extractDocxText(await file.readBytes()) };
    case "pdf":
      return { ...base, kind: "pdf", text: await extractPdfText(await file.readBytes(), { workerUrl }) };
    case "doc":
      throw new ImportUnsupportedError(
        "旧版 .doc 格式不支持直接导入：请先在 Word 中打开该文件，另存为 .docx 后再导入。",
      );
    default:
      throw new ImportUnsupportedError(
        `不支持的文件格式${file.ext ? `「.${file.ext}」` : ""}：可导入 txt / md / docx / pdf。`,
      );
  }
}
