// spec: theme-system 双轴解析（design D1）—— swiss/apple × light/dark/system 全分支。
import { describe, expect, it } from "vitest";
import { colorSchemeOf, resolveTheme } from "./theme";

describe("resolveTheme 双轴解析", () => {
  it("明暗显式选择直接生效，不受系统影响", () => {
    expect(resolveTheme("swiss", "light", true)).toBe("swiss-light");
    expect(resolveTheme("swiss", "dark", false)).toBe("swiss-dark");
    expect(resolveTheme("apple", "light", true)).toBe("apple-light");
    expect(resolveTheme("apple", "dark", false)).toBe("apple-dark");
  });

  it("system 由系统明暗决定", () => {
    expect(resolveTheme("swiss", "system", false)).toBe("swiss-light");
    expect(resolveTheme("swiss", "system", true)).toBe("swiss-dark");
    expect(resolveTheme("apple", "system", false)).toBe("apple-light");
    expect(resolveTheme("apple", "system", true)).toBe("apple-dark");
  });
});

describe("colorSchemeOf", () => {
  it("随皮肤明暗返回 light/dark", () => {
    expect(colorSchemeOf("swiss-light")).toBe("light");
    expect(colorSchemeOf("apple-light")).toBe("light");
    expect(colorSchemeOf("swiss-dark")).toBe("dark");
    expect(colorSchemeOf("apple-dark")).toBe("dark");
  });
});
