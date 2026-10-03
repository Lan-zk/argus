// 主题解析与应用（spec: theme-system / design D1-D2）。
// 双轴偏好（theme × appearance）在 JS 侧合成为单一 data-theme 属性；
// CSS 侧（tokens.css）为 4 个平铺令牌块，无级联顺序依赖。

import type { Appearance, ThemeStyle } from "../domain/types";

/** 解析后的皮肤标识，对应 tokens.css 中的令牌块（swiss-light 即 :root 默认）。 */
export type ResolvedTheme = "swiss-light" | "swiss-dark" | "apple-light" | "apple-dark";

/** 双轴偏好 + 系统明暗 → 单一皮肤标识；appearance 为 system 时由 systemDark 决定明暗。 */
export function resolveTheme(theme: ThemeStyle, appearance: Appearance, systemDark: boolean): ResolvedTheme {
  const dark = appearance === "dark" || (appearance === "system" && systemDark);
  return `${theme}-${dark ? "dark" : "light"}`;
}

/** 皮肤 → CSS color-scheme（滚动条与原生控件跟随明暗）。 */
export function colorSchemeOf(resolved: ResolvedTheme): "light" | "dark" {
  return resolved.endsWith("-dark") ? "dark" : "light";
}

/** 把解析结果写入 <html>（幂等）。 */
export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = colorSchemeOf(resolved);
}
