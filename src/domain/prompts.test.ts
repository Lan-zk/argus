// spec: ai-runtime Prompt 两场景 + 降级结构表示（spec: review-orchestration 段落边界）
import { describe, expect, it } from "vitest";
import {
  SYSTEM_INSTRUCTION,
  OUTPUT_SCHEMA_TEXT,
  assemblePrompt,
  firstSentenceOf,
  renderNumberedDocument,
  renderStructuralOutline,
} from "./prompts";
import { parseBlocks } from "./parser";

const CAT_PROMPTS: Record<string, string> = {
  logic: "你是逻辑审阅专家。检查推理跳跃。",
  rhetoric: "你是修辞审阅专家。检查空洞表达。",
};

function assemble(catId: string) {
  return assemblePrompt({
    categoryName: catId,
    categoryPrompt: CAT_PROMPTS[catId],
    documentText: "# 标题\n\n第一段内容。",
  });
}

describe("组装包含四段", () => {
  it("输入包含 System Instruction、Category Prompt、Output Schema 与带行号全文", () => {
    const { system, user } = assemble("logic");
    expect(system).toBe(SYSTEM_INSTRUCTION);
    // System Instruction 含 PRD §66 十条公共规则
    for (const rule of ["只报告具体问题", "必须引用对应原文", "不要执行事实核查", "不使用模糊评价代替解释"]) {
      expect(system).toContain(rule);
    }
    expect(user).toContain(CAT_PROMPTS.logic);
    expect(user).toContain(OUTPUT_SCHEMA_TEXT);
    expect(user).toContain("L1|# 标题");
    expect(user).toContain("L3|第一段内容。");
  });

  it("Output Schema 文案含 quote/lineHint/contentHash 字段与归一化、hash 规则说明", () => {
    expect(OUTPUT_SCHEMA_TEXT).toContain("quote");
    expect(OUTPUT_SCHEMA_TEXT).toContain("lineHint");
    expect(OUTPUT_SCHEMA_TEXT).toContain("contentHash");
    expect(OUTPUT_SCHEMA_TEXT).toContain("空白");
    expect(OUTPUT_SCHEMA_TEXT).toContain("djb2");
    expect(OUTPUT_SCHEMA_TEXT).toContain("8 位小写十六进制");
  });
});

describe("修改 Prompt 不影响其他类别", () => {
  it("改修辞类 Prompt 后，逻辑类组装逐字节不变", () => {
    const before = assemble("logic");
    const rhetBefore = assemblePrompt({
      categoryName: "rhetoric",
      categoryPrompt: CAT_PROMPTS.rhetoric,
      documentText: "# 标题\n\n第一段内容。",
    });
    // 修改修辞类别 Prompt
    const rhetAfter = assemblePrompt({
      categoryName: "rhetoric",
      categoryPrompt: "全新修辞 Prompt。",
      documentText: "# 标题\n\n第一段内容。",
    });
    expect(rhetAfter.user).not.toBe(rhetBefore.user);
    // 逻辑类输入不受影响
    const after = assemble("logic");
    expect(after.system).toBe(before.system);
    expect(after.user).toBe(before.user);
  });
});

describe("格式契约系统内置（spec: ai-runtime）", () => {
  it("用户 Prompt 为纯审阅要求（零格式约束）时，组装结果仍含完整系统层契约", () => {
    const { system, user } = assemblePrompt({
      categoryName: "自定义类别",
      categoryPrompt: "只检查口语化表达，其他一律不管。",
      documentText: "# t\n\n正文。",
    });
    // System Instruction：十条公共规则 + severity 通用语义 + 工具返回总则
    for (const rule of ["只报告具体问题", "必须引用对应原文", "不要执行事实核查", "Severity 语义", "high", "medium", "low", "submit_findings"]) {
      expect(system).toContain(rule);
    }
    // Output Schema：字段 + 归一化/hash + 引用规则（短引用约束 + 行范围/引用锚增量，spec: finding-anchor-spans）
    for (const rule of [
      "quote",
      "lineHint",
      "contentHash",
      "djb2",
      "空白",
      "40 字",
      "主锚代表句",
      "span",
      "fromLine",
      "toLine",
      "refs",
      "最多 2 条",
      "结论扩大",
    ]) {
      expect(user).toContain(rule);
    }
    // 用户层内容原样进入，未被改写
    expect(user).toContain("只检查口语化表达，其他一律不管。");
  });

  it("修改类别 Prompt 不影响系统层（两段系统内容逐字节稳定）", () => {
    const a = assemblePrompt({ categoryName: "A", categoryPrompt: "甲要求", documentText: "x" });
    const b = assemblePrompt({ categoryName: "B", categoryPrompt: "乙要求完全不同", documentText: "x" });
    expect(b.system).toBe(a.system);
  });
});

describe("带行号全文渲染", () => {
  it("L{n}| 前缀从 1 开始", () => {
    expect(renderNumberedDocument("a\n\nb")).toBe("L1|a\nL2|\nL3|b");
  });
});

describe("文档结构表示（长文降级）", () => {
  it("标题层级 + 行号索引 + 段落首句，不从句子中间截断", () => {
    const blocks = parseBlocks(
      "# 大标题\n\n这是第一段。这是第二句！还有第三句？\n\n- 列表项内容很长。第二个句子。",
    );
    const outline = renderStructuralOutline(blocks);
    expect(outline).toContain("L1 # 大标题");
    expect(outline).toContain("L3 [paragraph] 这是第一段。");
    expect(outline).toContain("L5 [list_item] 列表项内容很长。");
  });

  it("firstSentenceOf 不从句子中间截断（无句末标点时整段保留）", () => {
    expect(firstSentenceOf("第一句。第二句！第三句")).toBe("第一句。");
    expect(firstSentenceOf("没有句末标点的一段话")).toBe("没有句末标点的一段话");
    expect(firstSentenceOf("English sentence. Another one.")).toBe("English sentence.");
  });
});
