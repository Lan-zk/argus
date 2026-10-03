// Orchestrator 端到端集成测试（tasks 5.6 / spec: review-orchestration 状态机、隔离、重跑、报告）。
// 用 pi-ai faux provider 按请求内容脚本化：成功 / 失败（401）/ 超时重试 / 上下文超限 / Structured Output 无效。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type MutableModels,
  type FauxResponseFactory,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { resetModelsCacheForTests, setModelsFactoryForTests } from "../ai/client";
import { Orchestrator, type SessionSink } from "./orchestrator";
import type { CategoryRun, Finding, ReviewReport, ReviewSession } from "../domain/types";
import type { ReviewCategory, ModelConfig } from "../domain/types";

function findingsToolCall(findings: Array<Record<string, unknown>>) {
  return fauxAssistantMessage([
    fauxToolCall("submit_findings", { findings } as never),
  ]);
}

const reportToolResponse = () =>
  fauxAssistantMessage([
    fauxToolCall("submit_report", {
      summary: "文章存在推理跳跃与论据不足问题。",
      priorityFindingIds: ["f1"],
      categorySummaries: [{ categoryId: "logic", summary: "逻辑问题集中在结论段。" }],
    }),
  ]);

/** 按请求内容路由：报告调用 vs 类别调用；类别内按类别名与脚本序号返回。 */
function makeResponder(
  categoryBehavior: (categoryName: string, requestSeq: number, req: string) => ReturnType<typeof fauxAssistantMessage>,
): FauxResponseFactory {
  const seqs = new Map<string, number>();
  return async (context: TranscriptContext) => {
    const req = JSON.stringify(context.messages);
    if (req.includes("submit_report")) return reportToolResponse();
    const catMatch = req.match(/【Category · (.+?)】/);
    const cat = catMatch?.[1] ?? "?";
    const n = (seqs.get(cat) ?? 0) + 1;
    seqs.set(cat, n);
    return categoryBehavior(cat, n, req);
  };
}

function errMsg(text: string) {
  return fauxAssistantMessage(" ", { stopReason: "error", errorMessage: text });
}

class MemSink implements SessionSink {
  session: ReviewSession | null = null;
  runs: Record<string, CategoryRun> = {};
  findings: Finding[] = [];
  report: ReviewReport | null = null;
  published: string[] = [];

  setSession(s: ReviewSession) {
    this.session = s;
  }
  setDocument(_d: import("../domain/types").Document) {}
  putRun(r: CategoryRun) {
    this.runs[r.categoryId] = r;
  }
  publishFindings(categoryId: string, findings: Finding[]) {
    this.published.push(categoryId);
    this.findings = [...this.findings.filter((f) => f.categoryId !== categoryId), ...findings];
  }
  setSessionStatus(status: ReviewSession["status"]) {
    if (this.session) this.session = { ...this.session, status };
  }
  setReport(r: ReviewReport) {
    this.report = r;
  }
}

const CATS: ReviewCategory[] = [
  {
    id: "logic",
    name: "逻辑",
    prompt: "你是逻辑审阅专家。",
    enabled: true,
    defaultSelected: true,
    order: 0,
  },
  {
    id: "structure",
    name: "结构",
    prompt: "你是结构审阅专家。",
    enabled: true,
    defaultSelected: true,
    order: 1,
  },
];

const MODEL: ModelConfig = {
  id: "m1",
  provider: "faux",
  model: "faux",
} as unknown as ModelConfig;

const DOC = "# 标题\n\n第一段内容，包含结论语句。\n\n第二段内容。\n\n第三段。";

async function run(
  behavior: Parameters<typeof makeResponder>[0],
  opts: { cats?: ReviewCategory[]; model?: ModelConfig; concurrency?: number } = {},
) {
  const faux = fauxProvider({ models: [{ id: "faux" }] });
  const models: MutableModels = createModels();
  models.setProvider(faux.provider);
  setModelsFactoryForTests(() => models);
  const responder = makeResponder(behavior);
  faux.setResponses([responder, responder, responder, responder, responder, responder, responder, responder, responder, responder]);

  const sink = new MemSink();
  const orch = new Orchestrator(sink, {
    getApiKey: async () => "test-key",
    concurrency: opts.concurrency ?? 3,
  });
  await orch.start({
    text: DOC,
    selectedCategories: opts.cats ?? CATS,
    modelConfig: opts.model ?? MODEL,
  });
  return { sink, orch, faux };
}

const okFindings = (cat: string) => [
  {
    severity: "high",
    title: cat === "逻辑" ? "推理跳跃" : "段落归属错位",
    quote: "第一段内容，包含结论语句",
    lineHint: 3,
    contentHash: "x",
    problem: "结论超出前文。",
    reason: "论据不足。",
    suggestion: "降低结论强度。",
  },
];

beforeEach(() => {
  resetModelsCacheForTests();
});
afterEach(() => {
  resetModelsCacheForTests();
});

describe("状态机（spec: review-orchestration）", () => {
  it("全部类别成功 → completed，完成即发布，报告自动生成且优先问题可追溯", async () => {
    const { sink } = await run((_cat, _n) => findingsToolCall(okFindings(_cat)));
    expect(sink.session?.status).toBe("completed");
    expect(sink.findings).toHaveLength(2);
    expect(sink.published).toContain("logic");
    expect(sink.report).not.toBeNull();
    // 优先问题必须关联已有 Finding
    const ids = new Set(sink.findings.map((f) => f.id));
    for (const pid of sink.report!.priorityFindingIds) expect(ids.has(pid)).toBe(true);
    // 计数程序计算
    const logic = sink.report!.categorySummaries.find((c) => c.categoryId === "logic")!;
    expect(logic.high).toBe(1);
    expect(logic.medium).toBe(0);
  });

  it("部分类别失败 → partial_failed，成功类别结果仍可查看", async () => {
    const { sink } = await run((cat) => (cat === "结构" ? errMsg("Request failed with status 401") : findingsToolCall(okFindings(cat))));
    expect(sink.session?.status).toBe("partial_failed");
    expect(sink.runs["structure"].status).toBe("failed");
    expect(sink.runs["logic"].status).toBe("completed");
    expect(sink.findings.some((f) => f.categoryId === "logic")).toBe(true);
    // 报告仍生成且列出失败类别
    expect(sink.report).not.toBeNull();
    expect(sink.report!.failedCategoryIds).toContain("structure");
  });

  it("全部失败 → failed", async () => {
    const { sink } = await run(() => errMsg("Request failed with status 401"));
    expect(sink.session?.status).toBe("failed");
  });
});

describe("失败隔离与重试", () => {
  it("超时自动重试后成功（首次超时，第二次成功）", async () => {
    const { sink } = await run((cat, n) =>
      cat === "结构" && n === 1 ? errMsg("Request timed out after 30000ms") : findingsToolCall(okFindings(cat)),
    );
    expect(sink.runs["structure"].status).toBe("completed");
    expect(sink.runs["structure"].retries).toBe(1);
    expect(sink.session?.status).toBe("completed");
  });

  it("配置类错误不重试（结构首次即 401 失败，仅消费一条响应）", async () => {
    let structureCalls = 0;
    const { sink } = await run((cat) => {
      if (cat === "结构") {
        structureCalls++;
        return errMsg("Request failed with status 401");
      }
      return findingsToolCall(okFindings(cat));
    });
    expect(structureCalls).toBe(1);
    expect(sink.runs["structure"].status).toBe("failed");
    expect(sink.runs["structure"].error).toContain("API Key 无效");
  });

  it("Structured Output 无效（无工具调用 + 修复仍失败）→ 类别失败且信息可读", async () => {
    const { sink } = await run((cat) =>
      cat === "结构" ? fauxAssistantMessage("我觉得这段写得不太好。") : findingsToolCall(okFindings(cat)),
    );
    expect(sink.runs["structure"].status).toBe("failed");
    expect(sink.runs["structure"].error).toContain("Structured Output 无效");
  });
});

describe("长文降级（spec: review-orchestration 降级两场景）", () => {
  it("contextWindow 极小触发降级：以结构表示为输入，定位算法与全文一致", async () => {
    let sawDegradedPrompt = false;
    const { sink } = await run((_cat, _n, req) => {
      if (req.includes("结构表示")) sawDegradedPrompt = true;
      return findingsToolCall(okFindings(_cat));
    }, { model: { ...MODEL, contextWindow: 500 } as ModelConfig });
    expect(sawDegradedPrompt).toBe(true);
    expect(sink.runs["logic"].degraded).toBe(true);
    // 定位仍基于原文块模型（anchor 不因降级改变）
    expect(sink.findings.every((f) => f.anchorStatus === "anchored")).toBe(true);
  });
});

describe("单类重跑（spec: review-orchestration 重跑两场景）", () => {
  it("重跑只影响该类别：旧 findings 被替换，他类不变；重跑后报告重新生成", async () => {
    const faux = fauxProvider({ models: [{ id: "faux" }] });
    const models: MutableModels = createModels();
    models.setProvider(faux.provider);
    setModelsFactoryForTests(() => models);
    const responder = makeResponder((cat, n) =>
      cat === "结构" && n <= 1 ? errMsg("Request failed with status 401") : findingsToolCall(okFindings(cat)),
    );
    faux.setResponses([responder, responder, responder, responder, responder, responder, responder, responder]);

    const sink = new MemSink();
    const orch = new Orchestrator(sink, { getApiKey: async () => "k", concurrency: 1 });
    await orch.start({ text: DOC, selectedCategories: CATS, modelConfig: MODEL });
    expect(sink.session?.status).toBe("partial_failed");
    const logicFindingsBefore = sink.findings.filter((f) => f.categoryId === "logic");

    // 用户修改 Prompt 后重跑结构类别
    const structureCat = { ...CATS[1], prompt: "全新的结构 Prompt。" };
    await orch.rerunCategory({ category: structureCat, modelConfig: MODEL });

    expect(sink.session?.status).toBe("completed");
    // 结构类别旧失败被新结果替换
    expect(sink.runs["structure"].status).toBe("completed");
    expect(sink.findings.some((f) => f.categoryId === "structure")).toBe(true);
    // 逻辑类别 findings 与状态不受影响
    expect(sink.findings.filter((f) => f.categoryId === "logic")).toEqual(logicFindingsBefore);
    // 报告重新生成（failedCategoryIds 清空）
    expect(sink.report?.failedCategoryIds).toEqual([]);
  });

  it("全部完成后重跑一个类别并成功 → 报告基于新 Findings 集合重新生成", async () => {
    const faux = fauxProvider({ models: [{ id: "faux" }] });
    const models: MutableModels = createModels();
    models.setProvider(faux.provider);
    setModelsFactoryForTests(() => models);
    let reportCalls = 0;
    const responder: FauxResponseFactory = async (context) => {
      const req = JSON.stringify(context.messages);
      if (req.includes("submit_report")) {
        reportCalls++;
        return reportToolResponse();
      }
      const catMatch = req.match(/【Category · (.+?)】/);
      return findingsToolCall(okFindings(catMatch?.[1] ?? ""));
    };
    faux.setResponses([responder, responder, responder, responder, responder, responder, responder, responder]);

    const sink = new MemSink();
    const orch = new Orchestrator(sink, { getApiKey: async () => "k", concurrency: 1 });
    await orch.start({ text: DOC, selectedCategories: CATS, modelConfig: MODEL });
    expect(sink.session?.status).toBe("completed");
    const reportsAfterFirstRun = reportCalls;
    expect(reportsAfterFirstRun).toBe(1);

    await orch.rerunCategory({ category: CATS[0], modelConfig: MODEL });
    expect(reportCalls).toBe(2);
    expect(sink.session?.status).toBe("completed");
  });
});
