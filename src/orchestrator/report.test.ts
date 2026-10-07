// spec: review-report 全部场景（输入约束、优先问题可追溯、降级）
import { describe, expect, it } from "vitest";
import { generateReport } from "./report";
import type { Document, Finding, ModelConfig, ReviewCategory, ReviewReport } from "../domain/types";
import { parseBlocks } from "../domain/parser";
import { withAnchors } from "../domain/anchor";

const DOC: Document = {
  id: "doc1",
  text: "# 标题\n\n正文内容。",
  blocks: parseBlocks("# 标题\n\n正文内容。"),
  createdAt: new Date().toISOString(),
};

const CATS: ReviewCategory[] = [
  { id: "logic", name: "逻辑", prompt: "p", enabled: true, defaultSelected: true, order: 0 },
  { id: "rhetoric", name: "修辞", prompt: "p", enabled: true, defaultSelected: true, order: 1 },
];

let n = 0;
function mkF(over: Partial<Finding> = {}): Finding {
  const f: Finding = {
    id: `f${++n}`,
    categoryId: "logic",
    severity: "medium",
    title: "推理跳跃",
    quote: "q",
    anchors: [],
    problem: "p",
    reason: "r",
    suggestion: "s",
    anchorStatus: "anchored",
    ...over,
  };
  return f.anchors.length > 0 ? f : withAnchors(f);
}

const FINDINGS: Finding[] = [
  mkF({ severity: "high" }),
  mkF({ severity: "high", title: "第二个" }),
  mkF({ severity: "high", title: "第三个" }),
  mkF({ severity: "medium" }),
  mkF({ severity: "medium", title: "第五个" }),
  mkF({ categoryId: "rhetoric", severity: "low", title: "空洞" }),
  mkF({ categoryId: "rhetoric", severity: "low", title: "重复" }),
];

describe("优先问题可追溯（程序化降级路径）", () => {
  it("priorityFindingIds 全部关联已有 Finding 且 ≤10", async () => {
    const report = await generateReport({
      document: DOC,
      findings: FINDINGS,
      categories: CATS,
      failedCategoryIds: [],
      modelConfig: null,
      apiKey: "",
    });
    const ids = new Set(FINDINGS.map((f) => f.id));
    expect(report.priorityFindingIds.length).toBeGreaterThan(0);
    expect(report.priorityFindingIds.length).toBeLessThanOrEqual(10);
    for (const id of report.priorityFindingIds) expect(ids.has(id)).toBe(true);
    expect(report.degraded).toBe(true);
  });

  it("优先问题按严重度排序且不超过 10 条", async () => {
    const report = await generateReport({
      document: DOC,
      findings: FINDINGS,
      categories: CATS,
      failedCategoryIds: [],
      modelConfig: null,
      apiKey: "",
    });
    expect(report.priorityFindingIds.length).toBe(7); // ≤10：全部已有 findings 依严重度排序
    const sevOf = (id: string) => FINDINGS.find((f) => f.id === id)!.severity;
    expect(sevOf(report.priorityFindingIds[0])).toBe("high");
    expect(sevOf(report.priorityFindingIds[report.priorityFindingIds.length - 1])).toBe("low");
  });
});

describe("Category Summary（计数程序计算 + 失败类别单列）", () => {
  it("按类别列出 严重/建议修改/可优化 计数；失败类别不计入", async () => {
    const report = await generateReport({
      document: DOC,
      findings: FINDINGS,
      categories: CATS,
      failedCategoryIds: ["rhetoric"],
      modelConfig: null,
      apiKey: "",
    });
    const logic = report.categorySummaries.find((c) => c.categoryId === "logic")!;
    expect(logic.high).toBe(3);
    expect(logic.medium).toBe(2);
    expect(logic.low).toBe(0);
    expect(report.categorySummaries.some((c) => c.categoryId === "rhetoric")).toBe(false);
    expect(report.failedCategoryIds).toEqual(["rhetoric"]);
  });
});

describe("报告标注失败类别", () => {
  it("摘要明确提及失败类别数量", async () => {
    const report = await generateReport({
      document: DOC,
      findings: FINDINGS,
      categories: CATS,
      failedCategoryIds: ["rhetoric"],
      modelConfig: null,
      apiKey: "",
    });
    expect(report.summary).toContain("失败");
  });
});

describe("模型报告路径（faux）", () => {
  it("使用模型返回的 summary 与类别小结，优先问题截到 5–10 且引用有效 id", async () => {
    const { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
    const { setModelsFactoryForTests, resetModelsCacheForTests } = await import("../ai/client");
    resetModelsCacheForTests();
    const faux = fauxProvider({ models: [{ id: "faux" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    setModelsFactoryForTests(() => models);
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall("submit_report", {
          summary: "模型摘要。",
          priorityFindingIds: ["f999", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f1", "f2", "f3", "f4"],
          categorySummaries: [{ categoryId: "logic", summary: "逻辑小结。" }],
        }),
      ]),
    ]);

    const MODEL = { id: "mx", provider: "faux", model: "faux" } as unknown as ModelConfig;
    const report: ReviewReport = await generateReport({
      document: DOC,
      findings: FINDINGS,
      categories: CATS,
      failedCategoryIds: [],
      modelConfig: MODEL,
      apiKey: "k",
    });
    // f999 不存在被过滤；重复去重；总长截到 10
    const ids = new Set(FINDINGS.map((f) => f.id));
    expect(report.priorityFindingIds.every((id) => ids.has(id))).toBe(true);
    expect(new Set(report.priorityFindingIds).size).toBe(report.priorityFindingIds.length);
    expect(report.summary).toBe("模型摘要。");
    expect(report.degraded).toBe(false);
    const logic = report.categorySummaries.find((c) => c.categoryId === "logic")!;
    expect(logic.summary).toBe("逻辑小结。");
    expect(logic.high).toBe(3); // 计数仍由程序计算
    resetModelsCacheForTests();
  });
});
