// 汇总报告生成（spec: review-report / PRD §39–42 / design 决策 9）。
// 输入仅限：文档概要、成功类别的 Findings、类别统计、失败类别信息。不重新审阅全文。
// 模型只产 summary / priorityFindingIds / 每类一句小结；计数程序计算。
// 模型调用失败降级为程序化报告，不阻塞结果查看。

import { Type, validateToolArguments } from "@earendil-works/pi-ai";
import type { Document, Finding, ModelConfig, ReviewCategory, ReviewReport } from "../domain/types";
import { SEVERITIES } from "../domain/types";
import { dlog } from "../domain/log";
import { appError, classifyError } from "../domain/errors";
import { resolveModel } from "../ai/client";
import { withRetry } from "../ai/retry";

const ReportTool = {
  name: "submit_report",
  description: "提交审阅汇总报告。必须恰好调用一次。",
  parameters: Type.Object(
    {
      summary: Type.String({ description: "总体摘要：概括主要问题，不重复罗列所有 Finding（150–300 字）" }),
      priorityFindingIds: Type.Array(Type.String(), {
        description: "优先问题的 Finding id（引用输入中给出的 id），5–10 条，按重要程度排序",
      }),
      categorySummaries: Type.Array(
        Type.Object({
          categoryId: Type.String(),
          summary: Type.String({ description: "该类别的一句小结（含主要问题倾向）" }),
        }),
        { description: "每个成功类别一条小结" },
      ),
    },
    { additionalProperties: false, required: ["summary", "priorityFindingIds", "categorySummaries"] },
  ),
} as const;

export interface ReportInput {
  document: Document;
  findings: Finding[];
  categories: ReviewCategory[];
  failedCategoryIds: string[];
  modelConfig: ModelConfig | null;
  apiKey: string;
  signal?: AbortSignal;
}

export async function generateReport(input: ReportInput): Promise<ReviewReport> {
  const counts = countByCategory(input.findings);
  if (input.modelConfig) {
    try {
      return await modelReport(input, counts);
    } catch (err) {
      dlog("报告", `报告模型调用失败 → 降级为程序化报告（${err instanceof Error ? err.message : err}）`, true);
    }
  }
  return programmaticReport(input, counts);
}

type Counts = Map<string, { high: number; medium: number; low: number }>;

function countByCategory(findings: Finding[]): Counts {
  const map: Counts = new Map();
  for (const f of findings) {
    const c = map.get(f.categoryId) ?? { high: 0, medium: 0, low: 0 };
    c[f.severity]++;
    map.set(f.categoryId, c);
  }
  return map;
}

function docBrief(document: Document): string {
  const headings = document.blocks.filter((b) => b.type.startsWith("heading"));
  return [
    `标题（首个 heading 或首行）：${document.blocks[0]?.plainText.slice(0, 40) ?? "（无）"}`,
    `总字符数：${document.text.length}`,
    `段落数：${document.blocks.length}`,
    `标题结构：${headings.map((h) => `${h.type}「${h.plainText.slice(0, 24)}」@L${h.line}`).join(" · ") || "（无标题）"}`,
  ].join("\n");
}

function findingsBrief(findings: Finding[], categories: ReviewCategory[]): string {
  const nameOf = (id: string) => categories.find((c) => c.id === id)?.name ?? id;
  return findings
    .map(
      (f) =>
        `{id:"${f.id}",category:"${nameOf(f.categoryId)}",severity:"${f.severity}",title:"${f.title}",quote:${JSON.stringify(f.quote.slice(0, 60))},problem:${JSON.stringify(f.problem.slice(0, 120))}}`,
    )
    .join("\n");
}

async function modelReport(input: ReportInput, counts: Counts): Promise<ReviewReport> {
  const { models, model } = await resolveModel(input.modelConfig!);
  const prompt = [
    "你是审阅报告撰写人。基于给定的文档概要与已有 Findings 撰写汇总报告。",
    "约束：",
    "- 不得重新审阅全文，不得创建 Findings 之外的新具体问题；",
    "- priorityFindingIds 只能引用输入 Findings 的 id，按重要程度排序，5–10 条（Findings 总数不足 5 条时全部列入）；",
    "- summary 概括主要问题倾向，不逐条罗列；",
    "- 每个成功类别一句小结。",
    "",
    `【文档概要】\n${docBrief(input.document)}`,
    `【Findings（id 供引用）】\n${findingsBrief(input.findings, input.categories) || "（无）"}`,
    `【失败类别（不计入摘要，需在关注外单列）】${input.failedCategoryIds.join("、") || "无"}`,
  ].join("\n");

  const assistant = await withRetry(
    () =>
      models.complete(
        model,
        {
          systemPrompt: "你是严谨的中文审阅报告撰写助手，以 submit_report 工具调用返回结果。",
          messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
          tools: [ReportTool],
        },
        {
          apiKey: input.apiKey,
          signal: input.signal,
          maxRetries: 0,
          maxTokens: input.modelConfig!.maxTokens ?? 2_048,
        },
      ),
    (err) => classifyError(err, [input.apiKey]),
  );

  const call = assistant.content.find(
    (b): b is Extract<typeof b, { type: "toolCall" }> => b.type === "toolCall" && b.name === ReportTool.name,
  );
  if (!call) throw appError("invalid_structured_output", "（报告模型未调用 submit_report）");
  const validated = validateToolArguments(ReportTool, {
    type: "toolCall",
    id: call.id,
    name: ReportTool.name,
    arguments: call.arguments as Record<string, never>,
  }) as { summary: string; priorityFindingIds: string[]; categorySummaries: { categoryId: string; summary: string }[] };

  return assembleReport(input, counts, validated.summary, validated.priorityFindingIds, validated.categorySummaries, false);
}

/** 组装最终报告：优先问题必须关联已有 Finding 且截到 5–10 条；计数程序计算。 */
function assembleReport(
  input: ReportInput,
  counts: Counts,
  summary: string,
  priorityIds: string[],
  categorySummaries: { categoryId: string; summary: string }[],
  degraded: boolean,
): ReviewReport {
  const existing = new Set(input.findings.map((f) => f.id));
  let priority = [...new Set(priorityIds.filter((id) => existing.has(id)))];
  if (priority.length > 10) priority = priority.slice(0, 10);
  if (priority.length < 5) {
    // 不足 5 条时按 severity（high>medium>low）从已有 Findings 补足，绝不虚构
    const rank = { high: 0, medium: 1, low: 2 } as const;
    const rest = [...input.findings]
      .filter((f) => !priority.includes(f.id))
      .sort((a, b) => rank[a.severity] - rank[b.severity]);
    priority.push(...rest.slice(0, 5 - priority.length).map((f) => f.id));
  }

  const summaries = new Map(categorySummaries.map((s) => [s.categoryId, s.summary]));
  return {
    summary,
    priorityFindingIds: priority,
    categorySummaries: input.categories
      .filter((c) => !input.failedCategoryIds.includes(c.id))
      .map((c) => {
        const n = counts.get(c.id) ?? { high: 0, medium: 0, low: 0 };
        return {
          categoryId: c.id,
          high: n.high,
          medium: n.medium,
          low: n.low,
          summary: summaries.get(c.id) ?? oneLineSummary(c.id, input.findings),
        };
      }),
    failedCategoryIds: [...input.failedCategoryIds],
    degraded,
    generatedAt: new Date().toISOString(),
  };
}

function oneLineSummary(categoryId: string, findings: Finding[]): string {
  const list = findings.filter((f) => f.categoryId === categoryId);
  if (!list.length) return "未发现该类别下的明显问题。";
  const high = list.filter((f) => f.severity === "high").length;
  return high > 0
    ? `发现 ${list.length} 个问题，其中 ${high} 个严重级，建议优先检查。`
    : `发现 ${list.length} 个问题，以中低严重度为主。`;
}

/** 程序化降级报告：纯统计 + 按严重度排序的优先列表。 */
function programmaticReport(input: ReportInput, counts: Counts): ReviewReport {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const priority = [...input.findings]
    .sort((a, b) => rank[a.severity] - rank[b.severity])
    .slice(0, 10)
    .map((f) => f.id);
  const total = input.findings.length;
  const high = input.findings.filter((f) => f.severity === "high").length;
  const summary = input.failedCategoryIds.length
    ? `本次审阅共记录 ${total} 个问题（严重 ${high} 个）；${input.failedCategoryIds.length} 个类别执行失败未计入，可单独重跑后重新生成报告。`
    : `本次审阅共记录 ${total} 个问题，其中严重 ${high} 个。建议从严重级问题开始检查。`;
  const report = assembleReport(input, counts, summary, priority, [], true);
  for (const c of input.categories.filter((x) => !input.failedCategoryIds.includes(x.id))) {
    const s = report.categorySummaries.find((x) => x.categoryId === c.id);
    if (s) s.summary = oneLineSummary(c.id, input.findings);
  }
  return report;
}

export { SEVERITIES };
