# importers/ — 文档文件导入（spec: document-import）

文件导入的提取与编排层：选择文件 → 格式判定与排除指引 → 按格式提取 → 统一纯文本汇入既有 `parseBlocks` 管线（块模型与行号契约不变，锚定算法零改动）。

## 模块

- `index.ts` — 编排入口 `importDocument()`：取消返回 null；旧版 `.doc` / 未识别格式抛 `ImportUnsupportedError`（含可行动指引，不做静默降级）。整棵子树由 New Review 页在点击导入时动态加载（mammoth / pdfjs / 插件 wrapper 均不进首屏）。
- `pick.ts` — 文件选择：Tauri 走 dialog 插件 `open()`（选中路径自动加入 fs 运行时授权域，capability 只有命令级最小权限）；纯浏览器 dev 降级 `<input type="file">`。
- `text-file.ts` — txt/md 直读归一（BOM 剥离 + CRLF→LF）与扩展名判定。
- `docx.ts` — `mammoth/mammoth.browser`（默认 node 入口会使 vite 构建失败，类型见 `src/types/mammoth-browser.d.ts`）docx → HTML → Markdown 风格文本；表格降级为「单元格 | 单元格」文本行，正文文字不丢。
- `pdf.ts` — pdfjs `getTextContent` → 按 x/y 聚类成行 → 断行拼段（行尾句读 / 缩进 / 拉丁连字符）→ 双栏按 x 中线尽力分栏；无文字层（字符数 < 32）抛 `ScannedPdfError`。worker 三层加载策略：同源静态 worker 资产（`?url` 导入，release CSP `default-src 'self'` 允许）→ pdfjs 内建伪 worker（worker 加载失败时经 workerSrc 主线程 import，macOS/Linux opaque origin 下 blob 包装被 CSP 拦截即走此路）→ 自身 catch 层注入 `globalThis.pdfjsWorker` 并覆写 pdfjs 记忆化的 `_setupFakeWorkerGlobal`（否则 rejected 缓存使兜底失效）后重跑。另 polyfill `Uint8Array.prototype.toHex`（旧 WebView / Node 24 缺失）。

## 已知限制（预览确认步兜底）

- 不做 OCR、不解析旧 `.doc`、不做 pdf 版面/表格结构还原（spec 边界）。
- pdfjs 未配 `standardFontDataUrl`：未嵌入字体的 PDF 宽度测量退化，可能影响双栏聚类精度（Word 导出的中文 PDF 通常嵌入字体子集，不受影响）。
- 通栏条目在双栏页中部时排序尽力而为。

## fixtures/

- `sample.docx` — 覆盖标题/段落/列表/引用/代码/表格的最小 OOXML 样本（供单测与手动验收）。
- `sample.docx.base64.ts` — 上述文件的 base64 内嵌（vitest 无 node:fs / vite 资产通道；再生成命令见文件头注释）。
