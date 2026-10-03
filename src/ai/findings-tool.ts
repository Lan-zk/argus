// submit_findings 工具（spec: ai-runtime Structured Output / design 决策 5）。
// TypeBox schema 即校验 Schema；模型以工具调用交回结构化结果。

import { Type, type Static, type Tool } from "@earendil-works/pi-ai";

export const FindingToolSchema = Type.Object(
  {
    severity: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")], {
      description: "严重程度：high=明显影响理解/逻辑/核心论证；medium=降低内容质量；low=可优化",
    }),
    title: Type.String({ description: "问题类型的简短命名，如「推理跳跃」" }),
    quote: Type.String({
      description: "逐字引用的原文连续片段（一个短句或短语），不得改写、概括或拼接",
    }),
    lineHint: Type.Optional(Type.Number({ description: "quote 所在行号（依据 L 行号标注）" })),
    contentHash: Type.Optional(
      Type.String({ description: "quote 去除全部空白后 djb2 变体哈希，8 位小写 hex" }),
    ),
    problem: Type.String({ description: "问题描述，具体不模糊" }),
    reason: Type.String({ description: "为什么这是一个问题" }),
    suggestion: Type.String({ description: "具体修改建议，不直接重写全文" }),
  },
  { additionalProperties: false },
);

export type ToolFinding = Static<typeof FindingToolSchema>;

export const SubmitFindingsTool: Tool = {
  name: "submit_findings",
  description:
    "提交本类别审阅得到的全部问题（Findings）。必须恰好调用一次；未发现问题时提交空数组。",
  parameters: Type.Object(
    {
      findings: Type.Array(FindingToolSchema, {
        description: "本类别的全部审阅结论；未发现问题时为空数组",
      }),
    },
    { additionalProperties: false, required: ["findings"] },
  ),
};
