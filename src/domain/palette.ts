// 自定义类别调色板（spec: theme-system 自定义类别调色板 / category-colors design D2）。
// 取值以 tokens.css 的 --p1..--p10 令牌引用保存：随「主题 × 明暗」自动切换，对比度由
// scripts/contrast-check.mjs 硬校验。色相取内置 7 类色环的空档，避免撞色。

export interface PaletteEntry {
  /** 令牌引用，直接存入 ReviewCategory.color。 */
  var: string;
  /** 中文色名（aria-label / 悬停提示）。 */
  label: string;
}

export const CATEGORY_PALETTE: PaletteEntry[] = [
  { var: "var(--p1)", label: "绿" },
  { var: "var(--p2)", label: "青柠" },
  { var: "var(--p3)", label: "天青" },
  { var: "var(--p4)", label: "天蓝" },
  { var: "var(--p5)", label: "靛蓝" },
  { var: "var(--p6)", label: "鸢尾紫" },
  { var: "var(--p7)", label: "紫红" },
  { var: "var(--p8)", label: "蓝灰" },
  { var: "var(--p9)", label: "勃艮第" },
  { var: "var(--p10)", label: "赭石" },
];

/** 新建类别兜底色：按现有自定义类别数确定性轮转（design D5）。 */
export function rotationColor(existingCustomCount: number): string {
  return CATEGORY_PALETTE[existingCustomCount % CATEGORY_PALETTE.length].var;
}
