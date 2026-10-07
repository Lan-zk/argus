// 四段 Prompt 组装（spec: ai-runtime / PRD §18 §66）：
// System Instruction（公共规则）→ Category Prompt（独立插槽）→ Output Schema（格式约束）→ Document Context（带行号全文）。
// 每个类别使用完全独立的组装，修改一个类别的 Prompt 不影响其他类别。

import type { DocumentBlock } from "./types";
import { normalizeNewlines } from "./normalize";

/** PRD §66 十条公共规则。 */
export const SYSTEM_INSTRUCTION = `你是一名严格的中文文稿审阅专家。每次审阅只针对一个 Review Category，输出该类别下的具体问题。

公共规则：
1. 只报告具体问题。
2. 每个 Finding 只描述一个主要问题。
3. 必须引用对应原文。
4. 不要为了增加 Finding 数量而制造问题。
5. 不要执行事实核查。
6. 不要假设外部事实。
7. 建议应具体。
8. 不直接重写整篇文章。
9. 不输出与当前 Category 无关的问题。
10. 不使用模糊评价代替解释。

不推荐的 Finding：「这段可以写得更好」（原因不具体）、「文章整体逻辑还有提升空间」（没有定位具体问题）、「这里可能有一点问题」（信息不足）。
推荐的 Finding：问题具体（结论范围大于论据支持的范围）、原因具体（前文只讨论三个案例，当前句子把结论扩大到了所有用户）、修改方向具体（建议限制结论范围）。

Severity 语义（通用定义，各类别可在此基础上校准）：
- high：明显影响文章理解、逻辑或核心论证，用户应优先检查；
- medium：降低内容质量，用户通常应该修改；
- low：不破坏主要内容，修改后可以提高质量。

你必须以一次 submit_findings 工具调用返回全部结果（详见 Output Schema）。`;

/** Output Schema 文案：字段约束 + 归一化与 hash 规则说明（PRD §33 + spec: finding-anchor-spans）。 */
export const OUTPUT_SCHEMA_TEXT = `输出要求（Structured Output）：
你必须以一次工具调用（submit_findings）返回全部结果，不得输出自由 Markdown。findings 数组可以为空（未发现问题时返回空数组）。

每个 Finding 必须包含以下字段：
- severity: "high" | "medium" | "low"。high=明显影响理解、逻辑或核心论证；medium=降低内容质量；low=不破坏主要内容，修改后可提高质量。
- title: 问题类型的简短命名（如「推理跳跃」）。
- quote: 逐字引用的原文片段（主锚代表句）。必须是 Document Context 中连续出现的一小段原文（一个短句或短语，建议不超过 40 字），不得改写、概括或跨段拼接。
- lineHint: quote 所在的行号（整数，依据 Document Context 的 L 行号标注）。
- contentHash: quote 的归一化内容哈希。计算规则：先去除 quote 中全部空白字符（含空格、换行、制表符），再对得到的字符串计算 djb2 变体哈希：初始 h=5381，对每个字符执行 h = (h*33 + code) >>> 0（无符号 32 位），输出 8 位小写十六进制（不足补前导 0）。
- problem: 问题描述（具体，不使用模糊评价）。
- reason: 问题原因（为什么这是一个问题）。
- suggestion: 具体修改建议（方向具体，不直接重写全文）。

可选字段（仅在问题本身需要时提供；不提供时按单句批注处理）：
- span: { fromLine, toLine }。仅当问题为连续大段的段落级/节奏型问题时提供：quote（代表句）必须落在该行范围内，且该范围覆盖问题的完整区间。不要用长引用代替行范围。
- refs: 引用锚数组，最多 2 条，每条含 quote / lineHint / contentHash（规则与主锚 quote 完全一致）。仅当问题为关系型（如结论扩大、前后矛盾、呼应断裂、重复章节）时提供：quote 钉住问题所在的主句，refs 指向它所参照的远处原文（如论据、铺垫句）。`;

/** Document Context：带行号标注的全文（L{n}| 前缀）。 */
export function renderNumberedDocument(text: string): string {
  const lines = normalizeNewlines(text).split("\n");
  return lines.map((ln, i) => `L${i + 1}|${ln}`).join("\n");
}

/** 文档结构表示（长文降级用，PRD §36–37）：标题层级 + 行号索引 + 段落首句，不从句子中间截断。 */
export function renderStructuralOutline(blocks: DocumentBlock[]): string {
  return blocks
    .map((b) => {
      const firstSentence = firstSentenceOf(b.plainText);
      if (b.type.startsWith("heading")) {
        const level = Number(b.type.slice("heading".length));
        return `L${b.line} ${"#".repeat(level)} ${b.plainText}`;
      }
      return `L${b.line} [${b.type}] ${firstSentence}`;
    })
    .join("\n");
}

/** 取段落首句：按。！？!?.切分，保留边界，不从句子中间截断。 */
export function firstSentenceOf(paragraph: string): string {
  const t = paragraph.trim();
  if (!t) return t;
  const m = t.match(/^[\s\S]*?[。！？!?…]/);
  if (m) return m[0].trim();
  const en = t.match(/^[\s\S]*?[.](?=\s|$)/);
  if (en) return en[0].trim();
  return t;
}

export interface PromptSegment {
  system: string;
  user: string;
}

/**
 * 组装一次类别调用的完整输入。system = System Instruction；user = Category Prompt + Output Schema + Document Context。
 * degraded 时以文档结构表示替代全文（降级不改变定位算法）。
 */
export function assemblePrompt(opts: {
  categoryName: string;
  categoryPrompt: string;
  documentText: string;
  degraded?: boolean;
  structuralOutline?: string;
}): PromptSegment {
  const docSection = opts.degraded
    ? `【Document Context · 结构表示（全文超长，已降级；行号仍为原文行号）】\n${opts.structuralOutline ?? ""}`
    : `【Document Context · 带行号全文】\n${renderNumberedDocument(opts.documentText)}`;
  const user = [
    `【Category · ${opts.categoryName}】`,
    opts.categoryPrompt.trim(),
    `【Output Schema】\n${OUTPUT_SCHEMA_TEXT}`,
    docSection,
  ].join("\n\n");
  return { system: SYSTEM_INSTRUCTION, user };
}
