// 文件选择（spec: document-import 支持格式与排除项）。
// Tauri：dialog 插件 open()（选中的路径自动加入 fs 运行时授权域，capability 只需命令级最小权限）；
// 纯浏览器 dev：dialog/fs 插件不可用，降级为 <input type="file">（与 persistence 分流惯例一致）。

import { isTauri } from "../tauri";
import { extensionOf, IMPORT_EXTENSIONS } from "./text-file";

export interface PickedFile {
  name: string;
  ext: string;
  readText(): Promise<string>;
  readBytes(): Promise<ArrayBuffer>;
}

/** 打开系统文件选择框（.doc 允许选中——为给出「另存为 .docx」指引）。取消返回 null。 */
export async function pickImportFile(): Promise<PickedFile | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      title: "导入文档",
      filters: [{ name: "可导入文档", extensions: [...IMPORT_EXTENSIONS] }],
    });
    if (typeof picked !== "string") return null; // 取消（或意外的多选形态）
    const name = picked.split(/[\\/]/).pop() ?? picked;
    return {
      name,
      ext: extensionOf(name),
      readText: async () => {
        const { readTextFile } = await import("@tauri-apps/plugin-fs");
        return readTextFile(picked);
      },
      readBytes: async () => {
        const { readFile } = await import("@tauri-apps/plugin-fs");
        const u8 = await readFile(picked);
        return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
      },
    };
  }
  // 浏览器 dev 兜底：input[type=file]；cancel 事件（现代浏览器）与空选都归为取消
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMPORT_EXTENSIONS.map((e) => `.${e}`).join(",");
    let settled = false;
    const done = (f: PickedFile | null) => {
      if (!settled) {
        settled = true;
        resolve(f);
      }
    };
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (!f) return done(null);
      done({
        name: f.name,
        ext: extensionOf(f.name),
        readText: () => f.text(),
        readBytes: () => f.arrayBuffer(),
      });
    });
    input.addEventListener("cancel", () => done(null));
    input.click();
  });
}
