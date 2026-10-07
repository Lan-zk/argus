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
      description: "逐字引用的原文连续片段（主锚代表句，一个短句或短语），不得改写、概括或拼接",
    }),
    lineHint: Type.Optional(Type.Number({ description: "quote 所在行号（依据 L 行号标注）" })),
    contentHash: Type.Optional(
      Type.String({ description: "quote 去除全部空白后 djb2 变体哈希，8 位小写 hex" }),
    ),
    span: Type.Optional(
      Type.Object(
        {
          fromLine: Type.Number({ description: "行范围起始行（含），依据 L 行号标注" }),
          toLine: Type.Number({ description: "行范围结束行（含）；quote 代表句必须落在范围内" }),
        },
        {
          additionalProperties: false,
          description:
            "仅当问题为连续大段的段落级/节奏型问题时提供：行范围覆盖问题完整区间，quote 为范围内代表句。不要用长引用代替行范围",
        },
      ),
    ),
    refs: Type.Optional(
      Type.Array(
        Type.Object(
          {
            quote: Type.String({ description: "引用锚：逐字短引用（与主锚 quote 同规则）" }),
            lineHint: Type.Optional(Type.Number({ description: "引用锚 quote 所在行号" })),
            contentHash: Type.Optional(
              Type.String({ description: "引用锚 quote 的归一化哈希（规则同主锚）" }),
            ),
          },
          { additionalProperties: false },
        ),
        {
          maxItems: 2,
          description:
            "仅当问题为关系型（结论扩大/前后矛盾/呼应断裂/重复章节）时提供：指向主句所参照的远处原文（论据、铺垫句等），最多 2 条",
        },
      ),
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
