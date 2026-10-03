// spec: finding-pipeline 规范化两场景
import { describe, expect, it } from "vitest";
import { normalizeFindings, repairSeverity } from "./normalizer";

let seq = 0;
const nextId = () => `f${++seq}`;

const base = {
  title: "推理跳跃",
  quote: "因此这个商业模式已经被验证",
  problem: "前文信息不足。",
  reason: "用户增长不能证明商业模式成立。",
  suggestion: "降低结论强度。",
};

describe("非法 severity 被修复", () => {
  it("critical → high（按规则映射），Finding 保留", () => {
    const { findings } = normalizeFindings([{ ...base, severity: "critical" }], "logic", nextId);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
  });

  it("完全未知 severity → medium 并保留", () => {
    expect(repairSeverity("超级严重", "t")).toBe("medium");
    const { findings } = normalizeFindings([{ ...base, severity: "超级严重" }], "logic", nextId);
    expect(findings[0].severity).toBe("medium");
  });

  it("大小写不敏感：High → high", () => {
    expect(repairSeverity("High", "t")).toBe("high");
  });
});

describe("quote 为空被丢弃", () => {
  it("空 quote 丢弃并记日志，其余正常处理", () => {
    const { findings, dropped } = normalizeFindings(
      [{ ...base, quote: "   " }, { ...base, title: "第二条" }],
      "logic",
      nextId,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe("第二条");
    expect(dropped).toBe(1);
  });
});

describe("必填字段校验与清理", () => {
  it("缺 problem/reason/suggestion 的 Finding 被丢弃", () => {
    const { findings, dropped } = normalizeFindings(
      [{ title: "缺字段", quote: "q", problem: "", reason: "r", suggestion: "s" }],
      "logic",
      nextId,
    );
    expect(findings).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it("字符串 lineHint 被转数字；非法 lineHint 忽略", () => {
    const { findings } = normalizeFindings(
      [{ ...base, lineHint: "19" }, { ...base, title: "b", lineHint: "abc" }],
      "logic",
      nextId,
    );
    expect(findings[0].lineHint).toBe(19);
    expect(findings[1].lineHint).toBeUndefined();
  });

  it("非对象条目被丢弃", () => {
    const { dropped } = normalizeFindings([null, "x", 42] as unknown as Array<Record<string, unknown>>, "logic", nextId);
    expect(dropped).toBe(3);
  });
});
