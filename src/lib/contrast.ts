// WCAG 对比度纯函数（spec: theme-system 主题内色彩可辨识 / category-colors design D4）。
// UI（类别取色低对比提示）与 scripts/contrast-check.mjs 共用本实现，避免两套算法漂移。
// 注意：本文件保持零依赖、无 TS 专有语法负担，便于 Node 脚本直接 import。

export interface Rgba {
  rgb: [number, number, number];
  a: number;
}

/** 解析 #rgb / #rgba / #rrggbb / #rrggbbaa / rgb() / rgba()；无法解析返回 null。 */
export function parseColor(value: string): Rgba | null {
  const v = value.trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { rgb, a };
  }
  const fn = v.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
  if (fn) {
    return {
      rgb: [+fn[1], +fn[2], +fn[3]],
      a: fn[4] === undefined ? 1 : +fn[4],
    };
  }
  return null;
}

/** 半透明前景按底色合成，返回不透明 rgb。 */
export function composite(fg: Rgba, bg: Rgba): [number, number, number] {
  return fg.rgb.map((c, i) => c * fg.a + bg.rgb[i] * (1 - fg.a)) as [number, number, number];
}

/** WCAG 相对亮度。 */
export function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 对比度比值；含 alpha 的前景先对底色合成。任一色无法解析返回 null。 */
export function contrastRatio(fg: string, bg: string): number | null {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return null;
  const fRgb = f.a < 1 ? composite(f, b) : f.rgb;
  const l1 = luminance(fRgb);
  const l2 = luminance(b.rgb);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** var(--x) 解析缓存；键含当前皮肤（主题切换即失效重解析）。仅浏览器环境填充。 */
const varCache = new Map<string, string>();

/** 把 CSS 颜色值解析为不透明 rgb；支持 hex/rgb()/rgba() 与 var(--token)（经 getComputedStyle 解析）。失败返回 null。 */
export function resolveToRgb(value: string): [number, number, number] | null {
  const v = value.trim();
  const varRef = v.match(/^var\((--[\w-]+)\)$/);
  if (varRef) {
    if (typeof document === "undefined") return null;
    const key = `${document.documentElement.dataset.theme ?? ""}|${varRef[1]}`;
    let raw = varCache.get(key);
    if (raw === undefined) {
      raw = getComputedStyle(document.documentElement).getPropertyValue(varRef[1]).trim();
      varCache.set(key, raw);
    }
    const parsed = parseColor(raw);
    return parsed ? parsed.rgb : null;
  }
  const parsed = parseColor(v);
  return parsed ? parsed.rgb : null;
}

/** 固定深墨（--ink-fixed 令牌的值），不随明暗皮肤翻转。 */
const INK_FIXED: [number, number, number] = [20, 17, 12];

/** 动态底色上的可读文字色（类别色钳制，评审遗留项）：白与固定深墨取对比更优者。
 *  白走 --on-accent（四皮肤恒白）；深色底配浅色时用恒深墨（暗面类别色为亮调，主题浅墨反而不可读）。
 *  无法解析时保守返回白（与钳制前现状一致）。 */
export function onColorText(bg: string): string {
  const rgb = resolveToRgb(bg);
  if (!rgb) return "var(--on-accent)";
  const l = luminance(rgb);
  const lInk = luminance(INK_FIXED);
  const white = 1.05 / (l + 0.05);
  const [hi, lo] = l > lInk ? [l, lInk] : [lInk, l];
  const ink = (hi + 0.05) / (lo + 0.05);
  return white >= ink ? "var(--on-accent)" : "var(--ink-fixed)";
}
