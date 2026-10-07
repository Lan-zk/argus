// 一次性对比度校验脚本（spec: theme-system 主题内色彩可辨识 / category-colors 调色板）。
// 解析 src/styles/tokens.css 的四组合令牌块，计算 WCAG 对比度：
//   正文（--ink / --ink70 / --ink50 合成）对 paper/paper2/card ≥ 4.5:1（ink50 亦按正文级校验——
//   契约：实义微标签与次要说明使用 ink50，四组合必须全部 AA）；
//   图形/强调（类别色、调色板 --p*、accent、danger、ochre、gray、徽章文字）对所在底 ≥ 3:1。
// 算法复用 src/lib/contrast.ts（与 UI 低对比提示同一实现）。
// 用法：node scripts/contrast-check.mjs   （任一硬性项不达标 → exit 1）

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { contrastRatio, parseColor, composite } from "../src/lib/contrast.ts";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/styles/tokens.css"), "utf8");

/** 解析 CSS 块 → { token: value } */
function parseBlock(source) {
  const decls = {};
  for (const m of source.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) decls[m[1]] = m[2].trim();
  return decls;
}

const blocks = {
  "swiss-light": parseBlock(css.match(/:root\{([\s\S]*?)\}/)[1]),
};
for (const name of ["swiss-dark", "apple-light", "apple-dark"]) {
  blocks[name] = parseBlock(css.match(new RegExp(`\\[data-theme="${name}"\\]\\{([\\s\\S]*?)\\}`))[1]);
}

function ratioTokens(fgRaw, bgRaw) {
  const hasAlpha = /rgba?\(|^#[0-9a-f]{4}$|^#[0-9a-f]{8}$/i.test(fgRaw);
  if (!hasAlpha) return contrastRatio(fgRaw, bgRaw);
  const f = parseColor(fgRaw);
  const b = parseColor(bgRaw);
  if (!f || !b) return null;
  return contrastRatio(`rgb(${composite(f, b).map((c) => Math.round(c)).join(",")})`, bgRaw);
}

// —— 校验规则（fg/bg 令牌名, 阈值, 级别）——
const CATEGORY_KEYS = ["c-logic", "c-thesis", "c-argument", "c-rhetoric", "c-structure", "c-clarity", "c-speech"];
const PALETTE_KEYS = Array.from({ length: 10 }, (_, i) => `p${i + 1}`);
const checks = [
  ...["paper", "paper2", "card"].map((bg) => ({ fg: "ink", bg, min: 4.5, level: "HARD", what: "正文" })),
  ...["paper", "card"].map((bg) => ({ fg: "ink70", bg, min: 4.5, level: "HARD", what: "次级文本(70%)" })),
  ...["paper", "card"].map((bg) => ({ fg: "ink50", bg, min: 4.5, level: "HARD", what: "微标签(50%)" })),
  ...["paper", "card"].flatMap((bg) => [
    { fg: "accent", bg, min: 3, level: "HARD", what: "强调色" },
    { fg: "danger", bg, min: 3, level: "HARD", what: "危险色" },
    { fg: "ochre", bg, min: 3, level: "HARD", what: "severity-medium" },
    { fg: "gray", bg, min: 3, level: "HARD", what: "severity-low" },
  ]),
  { fg: "on-accent", bg: "accent", min: 3, level: "HARD", what: "强调底文字" },
  { fg: "on-danger", bg: "danger", min: 3, level: "HARD", what: "危险底文字" },
  { fg: "pearl-ink", bg: "pearl", min: 4.5, level: "HARD", what: "珍珠按钮文字" },
  { fg: "on-cta", bg: "cta", min: 3, level: "HARD", what: "CTA 按钮文字" },
  ...CATEGORY_KEYS.flatMap((k) => [
    { fg: k, bg: "paper", min: 3, level: "HARD", what: `类别 ${k.slice(2)}` },
    { fg: k, bg: "card", min: 3, level: "HARD", what: `类别 ${k.slice(2)}` },
  ]),
  // 自定义类别调色板（spec: theme-system 自定义类别调色板）
  ...PALETTE_KEYS.flatMap((k) => [
    { fg: k, bg: "paper", min: 3, level: "HARD", what: `调色板 ${k}` },
    { fg: k, bg: "card", min: 3, level: "HARD", what: `调色板 ${k}` },
  ]),
];

let hardFail = 0;
const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);

for (const [theme, decls] of Object.entries(blocks)) {
  const resolve = (token) => {
    const v = decls[token.replace(/^--/, "")];
    if (!v) throw new Error(`${theme} 缺少令牌 --${token.replace(/^--/, "")}`);
    const ref = v.match(/^var\(--([a-z0-9-]+)\)$/);
    return ref ? decls[ref[1]] : v;
  };
  console.log(`\n== ${theme} ==`);
  for (const c of checks) {
    const fgRaw = resolve(c.fg);
    const bgRaw = resolve(c.bg);
    const r = ratioTokens(fgRaw, bgRaw);
    if (r === null) throw new Error(`${theme} ${c.fg} on ${c.bg}: 颜色无法解析（fg=${fgRaw} bg=${bgRaw}）`);
    const ok = r >= c.min;
    if (!ok && c.level === "HARD") hardFail++;
    const mark = ok ? "✓" : c.level === "HARD" ? "✗" : "~";
    console.log(` ${mark} ${pad(c.what, 16)} ${c.fg} on ${c.bg}: ${r.toFixed(2)}:1 (需≥${c.min})`);
  }
}

console.log(hardFail ? `\n${hardFail} 项硬性不达标` : "\n全部硬性项达标");
process.exit(hardFail ? 1 : 0);
