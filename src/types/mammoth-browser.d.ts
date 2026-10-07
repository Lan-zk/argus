// mammoth 浏览器构建的类型 shim（design D1）。
// 默认入口（lib/index.js）依赖 node 内置模块会使 vite 构建失败，故走包内
// mammoth.browser.js（UMD、无官方类型声明）；此处只声明本应用用到的 API 面。
declare module "mammoth/mammoth.browser" {
  export interface MammothResult {
    value: string;
    messages: { type: string; message: string }[];
  }
  export interface MammothOptions {
    styleMap?: string | string[];
  }
  export function convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: MammothOptions,
  ): Promise<MammothResult>;
}
