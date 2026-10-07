// pdf 文字层提取（spec: document-import 提取与归一化）：断行拼段 / 双栏尽力聚类 /
// 无文字层判定（tasks 3.2）+ pdfjs 管线集成与 worker 兜底（tasks 3.1）。
import { beforeEach, describe, expect, it } from "vitest";
import { buildPageText, clusterLines, extractPdfText, joinParagraphs, MIN_PDF_TEXT_CHARS, ScannedPdfError, type TextPiece } from "./pdf";

/** 便利构造：一行一个 piece。 */
const piece = (str: string, x: number, y: number, w = 200, h = 12): TextPiece => ({ str, x, y, w, h });

describe("断行拼段（joinParagraphs / clusterLines）", () => {
  it("行尾无句读的连续行拼回一个段落（CJK 直拼无空格）", () => {
    const lines = clusterLines([
      piece("这是一个被排版硬换行切断", 50, 700),
      piece("的长句子的一部分。", 50, 686),
    ]);
    expect(joinParagraphs(lines)).toBe("这是一个被排版硬换行切断的长句子的一部分。");
  });

  it("行尾句读 → 段落结束，下一行开新段", () => {
    const lines = clusterLines([
      piece("第一段结束。", 50, 700),
      piece("第二段开始。", 50, 686),
    ]);
    expect(joinParagraphs(lines)).toBe("第一段结束。\n\n第二段开始。");
  });

  it("下一行起始 x 明显缩进 → 新段落（即使上一行无句读）", () => {
    const lines = clusterLines([
      piece("段落第一行有首行缩进", 100, 700),
      piece("段落体第二行", 50, 686),
      piece("新段落首行缩进", 100, 672),
    ]);
    expect(joinParagraphs(lines)).toBe("段落第一行有首行缩进段落体第二行\n\n新段落首行缩进");
  });

  it("拉丁断词连字符：去连字直拼", () => {
    const lines = clusterLines([
      piece("the inter-", 50, 700, 60, 12),
      piece("national standard", 50, 686, 100, 12),
    ]);
    expect(joinParagraphs(lines)).toBe("the international standard");
  });

  it("拉丁词间以空格拼接", () => {
    const lines = clusterLines([
      piece("The quick brown", 50, 700, 100, 12),
      piece("fox jumps.", 50, 686, 80, 12),
    ]);
    expect(joinParagraphs(lines)).toBe("The quick brown fox jumps.");
  });

  it("同 y 多 item 按 x 排序后拼接；y 容差内归为同一行", () => {
    const lines = clusterLines([
      piece("世界", 80, 700.5, 30),
      piece("你好", 40, 700, 30),
      piece("第二行", 40, 686, 60),
    ]);
    expect(lines[0].text).toBe("你好世界");
    expect(lines).toHaveLength(2);
  });
});

describe("双栏与通栏（buildPageText）", () => {
  const leftCol = [
    piece("左栏段落第一行无句读", 40, 700),
    piece("左栏段落第二行结束。", 40, 686),
    piece("左栏第二段开始", 40, 672),
    piece("左栏第二段结束。", 40, 658),
  ];
  const rightCol = [
    piece("右栏段落第一行无句读", 320, 700),
    piece("右栏段落第二行结束。", 320, 686),
    piece("右栏第二段开始", 320, 672),
    piece("右栏第二段结束。", 320, 658),
  ];

  it("双栏按 x 中线聚类：左栏全文在前、右栏在后", () => {
    const out = buildPageText([...leftCol, ...rightCol], 600);
    const paras = out.split("\n\n");
    expect(paras[0]).toBe("左栏段落第一行无句读左栏段落第二行结束。");
    expect(paras[1]).toBe("左栏第二段开始左栏第二段结束。");
    expect(paras[2]).toBe("右栏段落第一行无句读右栏段落第二行结束。");
    expect(paras[3]).toBe("右栏第二段开始右栏第二段结束。");
  });

  it("跨栏通栏条目（宽 > 60% 页宽）独立成行且排在栏文之前", () => {
    const title = piece("全文通栏大标题", 50, 740, 500, 16);
    const out = buildPageText([title, ...leftCol, ...rightCol], 600);
    expect(out.split("\n\n")[0]).toBe("全文通栏大标题");
  });

  it("单栏页面直接拼段", () => {
    const out = buildPageText([piece("只有一栏", 50, 700), piece("仍然成段。", 50, 686)], 600);
    expect(out).toBe("只有一栏仍然成段。");
  });

  it("空 items 返回空串（扫描件页）", () => {
    expect(buildPageText([], 600)).toBe("");
  });
});

// ---- pdfjs 管线集成（构造最小合法 PDF，ASCII/Helvetica——CJK 拼段逻辑由上面的纯函数覆盖） ----

function pdfEsc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

interface PdfLine {
  x: number;
  y: number;
  text: string;
}

/** 程序化构造最小合法 PDF（Type1/Helvetica，xref 偏移精确计算；仅 ASCII 文本）。 */
function buildPdf(pages: { w: number; h: number; lines: PdfLine[] }[]): Uint8Array {
  const fontId = 3 + pages.length * 2;
  const bodies = new Map<number, string>();
  bodies.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  bodies.set(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] >>`,
  );
  pages.forEach((p, i) => {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    bodies.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.w} ${p.h}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    const ops = p.lines
      .map((l) => `BT /F1 10 Tf 1 0 0 1 ${l.x.toFixed(2)} ${l.y.toFixed(2)} Tm (${pdfEsc(l.text)}) Tj ET`)
      .join("\n");
    bodies.set(contentId, `<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
  });
  bodies.set(fontId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let out = "%PDF-1.4\n";
  const offsets: number[] = [0];
  const maxId = fontId;
  for (let id = 1; id <= maxId; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${bodies.get(id)}\nendobj\n`;
  }
  const xrefPos = out.length;
  out += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

// 集成用例离线化：CI 共享 runner 上 happy-dom Worker / workerSrc 的网络失败是慢失败
// （DNS 重试拖到超时），与本地快失败行为不一致。统一预注入主线程 worker（pdfjs 见
// globalThis.pdfjsWorker 即不再 spawn 真 worker），零网络依赖；兜底用例以同步抛错的
// Worker + 预置 rejected 加载器模拟双失败，同样离线复现 release CSP 下的真实路径。
async function injectMainThreadWorker() {
  const workerModule = await import("pdfjs-dist/build/pdf.worker.mjs");
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = workerModule;
  const pdfjs = await import("pdfjs-dist");
  Object.defineProperty(pdfjs.PDFWorker, "_setupFakeWorkerGlobal", {
    value: Promise.resolve(workerModule.WorkerMessageHandler),
    configurable: true,
    writable: true,
    enumerable: true,
  });
}

describe("extractPdfText（pdfjs 集成）", () => {
  // CI 慢环境下 worker 初始化预算放宽（本地毫秒级）
  beforeEach(async () => {
    await injectMainThreadWorker();
  });

  it("断行拼回段落 + 句读分段 + 多页以空行相接", { timeout: 30000 }, async () => {
    const bytes = buildPdf([
      {
        w: 612,
        h: 792,
        lines: [
          { x: 50, y: 700, text: "The quick brown" },
          { x: 50, y: 686, text: "fox jumps." },
          { x: 50, y: 672, text: "New paragraph here." },
        ],
      },
      {
        w: 612,
        h: 792,
        lines: [{ x: 50, y: 700, text: "Second page content." }],
      },
    ]);
    const text = await extractPdfText(bytes.buffer as ArrayBuffer);
    expect(text).toContain("The quick brown fox jumps.");
    expect(text).toContain("New paragraph here.");
    expect(text).toContain("Second page content.");
    // 页与页之间空行分隔（parseBlocks 分组契约）
    expect(text).toMatch(/jumps\.\n\nNew paragraph/);
    expect(text).toMatch(/here\.\n\nSecond page/);
  });

  it("无文字层（扫描件）→ ScannedPdfError 且文案给出改用指引", { timeout: 30000 }, async () => {
    const bytes = buildPdf([{ w: 612, h: 792, lines: [] }]);
    await expect(extractPdfText(bytes.buffer as ArrayBuffer)).rejects.toBeInstanceOf(ScannedPdfError);
    await expect(extractPdfText(bytes.buffer as ArrayBuffer)).rejects.toThrow(/文字层/);
  });

  it("略高于阈值的极短文本不判为扫描件", { timeout: 30000 }, async () => {
    expect(MIN_PDF_TEXT_CHARS).toBe(32);
    const bytes = buildPdf([
      { w: 612, h: 792, lines: [{ x: 50, y: 700, text: "Short but real text layer exists here ok." }] },
    ]);
    await expect(extractPdfText(bytes.buffer as ArrayBuffer)).resolves.toContain("Short but real");
  });

  // 最后执行：兜底重跑会重新注入主线程 worker（beforeEach 已恢复现场，顺序仅保持习惯）
  it("worker 与 workerSrc 资产同时失败 → 注入主线程 handler 后重跑成功（3.1 兜底）", { timeout: 30000 }, async () => {
    const pdfjs = await import("pdfjs-dist");
    const RealWorker = globalThis.Worker;
    try {
      // 双失败 = Worker 构造被拦（同步抛错，替代慢网络失败）+ fake worker 加载器已 rejected
      (globalThis as { Worker?: unknown }).Worker = class {
        constructor() {
          throw new Error("Worker blocked by CSP (test)");
        }
      };
      delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;
      Object.defineProperty(pdfjs.PDFWorker, "_setupFakeWorkerGlobal", {
        value: Promise.reject(new Error("workerSrc asset unavailable (test)")),
        configurable: true,
        writable: true,
      });
      const bytes = buildPdf([
        { w: 612, h: 792, lines: [{ x: 50, y: 700, text: "Fallback extraction still works fine." }] },
      ]);
      const text = await extractPdfText(bytes.buffer as ArrayBuffer);
      expect(text).toContain("Fallback extraction still works fine.");
    } finally {
      (globalThis as { Worker?: unknown }).Worker = RealWorker;
      await injectMainThreadWorker();
    }
  });
});
