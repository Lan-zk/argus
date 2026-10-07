// pdf 文字层提取（spec: document-import 提取与归一化）。
// pdfjs getTextContent → 按 x/y 坐标聚类为行 → 断行拼回语义段落 → 双栏按 x 中线尽力分栏。
// 不做版面/表格结构还原（spec 边界）：错误排序由预览确认步兜底，用户可手动修正。
// 无文字层（扫描件/图片型）判定后明确排除，不做 OCR。

/** 扫描件或图片型 PDF：无可提取文字层，走排除提示（spec: 支持格式与排除项）。 */
export class ScannedPdfError extends Error {
  constructor() {
    super(
      "该 PDF 没有可提取的文字层（扫描件或图片型 PDF），暂不支持导入。请改用文字版 PDF，或将文本复制后直接粘贴。",
    );
    this.name = "ScannedPdfError";
  }
}

/** 无文字层判定阈值：全部页提取的非空白字符总数低于此值判为扫描件。 */
export const MIN_PDF_TEXT_CHARS = 32;

/** pdfjs text item 的最小投影（transform = [a,b,c,d,e,f]：x = e，y = f）。 */
export interface TextPiece {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TextLine {
  text: string;
  x0: number;
  y: number;
  /** 行内最大字高（行距容差与首行缩进判定基准）。 */
  h: number;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const isCjk = (ch: string | undefined): boolean =>
  !!ch && /[\u2e80-\u9fff\u3000-\u30ff\uff00-\uffef]/.test(ch);

/** 行尾句读：句末标点视为段落结束（逗号、顿号不算——那是句中续行）。 */
const SENTENCE_END = /[。！？；…⋯」』》〉”’）)!?;;.．]$/;

/** 坐标 → 行：按 y 聚类（容差 = 中位字高 × 0.7），行内按 x 排序拼接。 */
export function clusterLines(pieces: TextPiece[]): TextLine[] {
  if (pieces.length === 0) return [];
  const tol = (median(pieces.map((p) => p.h)) || 10) * 0.7;
  const sorted = [...pieces].sort((a, b) => b.y - a.y);
  const groups: { y: number; pieces: TextPiece[] }[] = [];
  for (const p of sorted) {
    const cur = groups[groups.length - 1];
    if (cur && Math.abs(cur.y - p.y) <= tol) cur.pieces.push(p);
    else groups.push({ y: p.y, pieces: [p] });
  }
  return groups
    .map((g) => {
      const ps = [...g.pieces].sort((a, b) => a.x - b.x);
      let text = "";
      for (const p of ps) {
        if (text === "") text = p.str;
        else if (isCjk(text[text.length - 1]) || isCjk(p.str[0])) text += p.str;
        else text = `${text.replace(/\s+$/, "")} ${p.str.replace(/^\s+/, "")}`;
      }
      return {
        text: text.replace(/\s+/g, " ").trim(),
        x0: ps[0].x,
        y: g.y,
        h: Math.max(...ps.map((p) => p.h)),
      };
    })
    .filter((l) => l.text !== "");
}

/** 行 → 段落：行尾无句读且下一行起始 x 与段落体一致 → 拼接；拉丁断词连字符去连字直拼。 */
export function joinParagraphs(lines: TextLine[]): string {
  if (lines.length === 0) return "";
  const indentThreshold = (median(lines.map((l) => l.h)) || 10) * 1.2;
  const paras: string[] = [];
  let cur = lines[0].text;
  let bodyX = lines[0].x0;
  const breakAt = (line: TextLine) => {
    paras.push(cur);
    cur = line.text;
    bodyX = line.x0;
  };
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const next = lines[i];
    // 下一行明显缩进（如中文段首两格）→ 新段落，即使上一行没有句读
    if (SENTENCE_END.test(prev.text) || next.x0 - bodyX > indentThreshold) {
      breakAt(next);
    } else if (prev.text.endsWith("-")) {
      cur = cur.slice(0, -1) + next.text;
      bodyX = Math.min(bodyX, next.x0);
    } else if (isCjk(cur[cur.length - 1]) || isCjk(next.text[0])) {
      cur += next.text;
      bodyX = Math.min(bodyX, next.x0);
    } else {
      cur += ` ${next.text}`;
      bodyX = Math.min(bodyX, next.x0);
    }
  }
  paras.push(cur);
  return paras.join("\n\n");
}

/** 双栏判定：左右两半（中线 ±5%）各有 ≥30% 且 ≥4 个 item 时认为双栏。 */
function detectTwoColumns(pieces: TextPiece[], pageWidth: number): boolean {
  const mid = pageWidth / 2;
  const margin = pageWidth * 0.05;
  let left = 0;
  let right = 0;
  for (const p of pieces) {
    const cx = p.x + p.w / 2;
    if (cx < mid - margin) left++;
    else if (cx > mid + margin) right++;
  }
  return pieces.length >= 8 && left >= Math.max(4, pieces.length * 0.3) && right >= Math.max(4, pieces.length * 0.3);
}

/**
 * 一页的 items → 该页文本：跨栏通栏条目（宽 > 60% 页宽，如大标题）独立成行置顶；
 * 其余按单栏或双栏（左栏先、右栏后）聚类拼段。通栏条目在页中部时排序尽力而为，预览步兜底。
 */
export function buildPageText(pieces: TextPiece[], pageWidth: number): string {
  if (pieces.length === 0) return "";
  const spans = pieces.filter((p) => p.w > pageWidth * 0.6);
  const rest = pieces.filter((p) => p.w <= pageWidth * 0.6);
  const parts: string[] = spans.map((l) => l.str.trim()).filter(Boolean);
  if (rest.length > 0) {
    if (detectTwoColumns(rest, pageWidth)) {
      const mid = pageWidth / 2;
      const left = rest.filter((p) => p.x + p.w / 2 < mid);
      const right = rest.filter((p) => p.x + p.w / 2 >= mid);
      parts.push(joinParagraphs(clusterLines(left)), joinParagraphs(clusterLines(right)));
    } else {
      parts.push(joinParagraphs(clusterLines(rest)));
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

/** pdfjs text item（getTextContent 返回项）的最小结构。 */
interface PdfTextItem {
  str: string;
  width: number;
  height: number;
  transform: number[];
}

/**
 * pdfjs 现行构建依赖 `Uint8Array.prototype.toHex`（TC39 hex/base64 提案，Chrome 141+ /
 * Safari 18.2+；XRef fingerprints 两分支均调用）。Node 24 与较旧的 WebView
 * （macOS WKWebView / Linux WebKitGTK 随系统版本）尚无此 API，缺失时补等价实现，
 * 保证三平台可用；运行时原生支持时不做任何覆盖。
 */
function ensureToHexPolyfill(): void {
  const proto = Uint8Array.prototype as Uint8Array & { toHex?: () => string };
  if (typeof proto.toHex === "function") return;
  proto.toHex = function (this: Uint8Array): string {
    let out = "";
    for (const b of this) out += b.toString(16).padStart(2, "0");
    return out;
  };
}

/**
 * pdf 二进制 → 文本。pdfjs 动态加载；worker 受阻时兜底切主线程伪 worker
 * （globalThis.pdfjsWorker 已设时 pdfjs 不再 spawn 真实 worker，性能下降但可用）。
 */
export async function extractPdfText(data: ArrayBuffer, opts?: { workerUrl?: string }): Promise<string> {
  const run = async (): Promise<string> => {
    ensureToHexPolyfill();
    const pdfjs = await import("pdfjs-dist");
    if (opts?.workerUrl) pdfjs.GlobalWorkerOptions.workerSrc = opts.workerUrl;
    // pdfjs 可能 transfer 底层 buffer（真 worker 场景会 detach），每次运行用副本
    const bytes = new Uint8Array(data.slice(0));
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    try {
      const pages: string[] = [];
      let totalChars = 0;
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        try {
          const viewport = page.getViewport({ scale: 1 });
          const tc = await page.getTextContent();
          const pieces: TextPiece[] = [];
          for (const raw of tc.items as PdfTextItem[]) {
            if (typeof raw?.str !== "string" || raw.str === "") continue;
            pieces.push({
              str: raw.str,
              x: raw.transform[4],
              y: raw.transform[5],
              w: raw.width,
              h: raw.height || Math.abs(raw.transform[3]) || 10,
            });
          }
          totalChars += pieces.reduce((n, p) => n + p.str.replace(/\s+/g, "").length, 0);
          const pageText = buildPageText(pieces, viewport.width);
          if (pageText) pages.push(pageText);
        } finally {
          page.cleanup();
        }
      }
      if (totalChars < MIN_PDF_TEXT_CHARS) throw new ScannedPdfError();
      return `${pages.join("\n\n")}\n`;
    } finally {
      void doc.destroy();
    }
  };
  try {
    return await run();
  } catch (e) {
    if (e instanceof ScannedPdfError) throw e;
    const workerModule = await import("pdfjs-dist/build/pdf.worker.mjs");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = workerModule;
    // pdfjs 以 shadow() 记忆化伪 worker 加载器（解析为 Promise<WorkerMessageHandler>）：
    // worker 与 workerSrc 资产同时失败时会留下 rejected 缓存，重跑也不会用上刚注入的
    // 主线程 handler。这里直接覆写为 resolved promise（pdfjs-dist 5.x 内部字段名，随
    // 版本升级需复核）。defineProperty 对访问器与数据属性均可安全替换。
    const pdfjs = await import("pdfjs-dist");
    Object.defineProperty(pdfjs.PDFWorker, "_setupFakeWorkerGlobal", {
      value: Promise.resolve(workerModule.WorkerMessageHandler),
      configurable: true,
      writable: true,
      enumerable: true,
    });
    return run();
  }
}
