// spec: settings 默认 Prompt 不含格式约束（prompt-layering）
import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "./default-categories";

const FORBIDDEN = ["djb2", "归一化", "引用与定位规则", "Severity 判断规则", "8 位", "submit_findings"];

describe("默认类别 Prompt 仅含审阅要求", () => {
  it("7 类 Prompt 均不含数据格式约束字样，且各含一行 Severity 校准", () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(7);
    for (const c of DEFAULT_CATEGORIES) {
      for (const f of FORBIDDEN) {
        expect(c.prompt, `${c.id} 含格式约束字样「${f}」`).not.toContain(f);
      }
      expect(c.prompt, `${c.id} 缺校准行`).toContain("Severity 校准：");
      expect(c.prompt).toContain("检查项：");
    }
  });
});
