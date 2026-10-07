// pdfjs worker 构建产物无类型声明（主入口 types 只覆盖 pdf.d.ts）。
// 主线程伪 worker 兜底路径会把整个模块挂到 globalThis.pdfjsWorker，
// pdfjs 读取其 WorkerMessageHandler 导出。
declare module "pdfjs-dist/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
