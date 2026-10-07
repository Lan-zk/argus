// spec: category-colors —— 共享对比度函数（design D4）。
import { describe, expect, it } from "vitest";
import { composite, contrastRatio, luminance, onColorText, parseColor, resolveToRgb } from "./contrast";

describe("parseColor", () => {
  it("解析 3/6/8 位 hex 与 rgb()/rgba()", () => {
    expect(parseColor("#fff")).toEqual({ rgb: [255, 255, 255], a: 1 });
    expect(parseColor("#000000")).toEqual({ rgb: [0, 0, 0], a: 1 });
    expect(parseColor("#ff000080")).toEqual({ rgb: [255, 0, 0], a: 128 / 255 });
    expect(parseColor("rgba(23,21,15,.7)")).toEqual({ rgb: [23, 21, 15], a: 0.7 });
    expect(parseColor("var(--paper)")).toBeNull();
  });
});

describe("composite / luminance", () => {
  it("半透明黑在白底上合成后趋近灰", () => {
    const c = composite({ rgb: [0, 0, 0], a: 0.5 }, { rgb: [255, 255, 255], a: 1 });
    expect(c.every((x) => Math.abs(x - 127.5) < 1)).toBe(true);
  });
  it("白与黑亮度为极值", () => {
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(luminance([0, 0, 0])).toBeCloseTo(0, 5);
  });
});

describe("contrastRatio", () => {
  it("黑白 21:1；含 alpha 前景按底色合成后计算", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    const withAlpha = contrastRatio("rgba(0,0,0,.5)", "#ffffff");
    expect(withAlpha).not.toBeNull();
    expect(withAlpha!).toBeCloseTo(grayOnWhiteRatio(), 1);
  });
  it("无法解析返回 null", () => {
    expect(contrastRatio("var(--x)", "#fff")).toBeNull();
    expect(contrastRatio("#fff", "nonsense")).toBeNull();
  });
});

/** rgba(0,0,0,.5) 合成到白底 ≈ #808080 的理论对比度（≈3.94:1）。 */
function grayOnWhiteRatio(): number {
  const l = luminance([127.5, 127.5, 127.5]);
  return (1.05) / (l + 0.05);
}

describe("onColorText 动态钳制（评审遗留：类别色底上的文字对比度）", () => {
  it("深底配白（--on-accent），浅底配固定深墨（--ink-fixed）", () => {
    expect(onColorText("#000000")).toBe("var(--on-accent)");
    expect(onColorText("#1a1a2e")).toBe("var(--on-accent)");
    expect(onColorText("#ffffff")).toBe("var(--ink-fixed)");
    expect(onColorText("#ffffcc")).toBe("var(--ink-fixed)");
  });
  it("中亮度类别色取对比更优者（内置绿 #1e8e4a：白 4.18 vs 深墨 4.44 → 深墨）", () => {
    expect(onColorText("#1e8e4a")).toBe("var(--ink-fixed)");
  });
  it("无法解析保守回退白（与钳制前现状一致）", () => {
    expect(onColorText("not-a-color")).toBe("var(--on-accent)");
  });
});

describe("resolveToRgb", () => {
  it("hex / rgb() 直解析；垃圾值返回 null", () => {
    expect(resolveToRgb("#ff0000")).toEqual([255, 0, 0]);
    expect(resolveToRgb("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
    expect(resolveToRgb("bogus")).toBeNull();
  });
});
