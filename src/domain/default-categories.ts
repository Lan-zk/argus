// 内置 7 个默认 Review Category（spec: settings / PRD §14）。
// 6 个默认启用（逻辑/论点/论证/修辞/结构/清晰度）+ 1 个默认禁用（演讲表达）。
// Prompt 基于原型 DEFAULT_CATS 扩写：检查项、severity 判断规则、引用与 hash 规则引用。

import type { ReviewCategory } from "./types";

const COLOR = {
  logic: "var(--c-logic)",
  thesis: "var(--c-thesis)",
  argument: "var(--c-argument)",
  rhetoric: "var(--c-rhetoric)",
  structure: "var(--c-structure)",
  clarity: "var(--c-clarity)",
  speech: "var(--c-speech)",
} as const;

const SEVERITY_RULES = `Severity 判断规则：
- high：明显影响文章理解、逻辑或核心论证，用户应优先检查；
- medium：降低内容质量，用户通常应该修改；
- low：不破坏主要内容，修改后可以提高质量。`;

const QUOTE_RULES = `引用与定位规则：
- quote 必须从 Document Context 中逐字复制一小段连续原文（一个短句或短语，建议不超过 40 字），不得改写、概括或跨段拼接；
- lineHint 填写 quote 所在行的 L 行号；
- contentHash 按本文档 Output Schema 中的规则计算（去空白后 djb2，8 位 hex）；
- 段落级问题引用该段中最能代表问题的一句，不要引用整段。`;

function prompt(role: string, checks: string, extra: string): string {
  return [role, `检查项：\n${checks}`, extra, SEVERITY_RULES, QUOTE_RULES].join("\n\n");
}

export const DEFAULT_CATEGORIES: ReviewCategory[] = [
  {
    id: "logic",
    name: "逻辑",
    en: "Logic",
    color: COLOR.logic,
    description: "推理跳跃 · 因果错误 · 前后矛盾 · 结论扩大（只分析文本内部逻辑，不做事实核查）",
    enabled: true,
    defaultSelected: true,
    order: 0,
    prompt: prompt(
      "你是逻辑审阅专家，只分析文本内部逻辑，不判断外部事实是否真实。",
      [
        "推理跳跃（结论超出前文给出的信息）",
        "因果关系错误（把相关当因果、因果倒置、单因解释）",
        "前后矛盾（同一问题前后判断不一致）",
        "结论扩大（结论范围大于论据能够支持的范围）",
        "前提不足（依赖未给出或未论证的前提）",
        "概念变化 / 概念偷换（同一词语前后含义不一致）",
        "逻辑链缺失（缺少中间论证环节）",
      ].map((s) => `- ${s}`).join("\n"),
      "每个 Finding 只描述一个主要逻辑问题，并指出问题所在的具体语句。",
    ),
  },
  {
    id: "thesis",
    name: "论点",
    en: "Thesis",
    color: COLOR.thesis,
    description: "核心观点是否明确 · 是否前后一致 · 结论是否出现新论点",
    enabled: true,
    defaultSelected: true,
    order: 1,
    prompt: prompt(
      "你是论点审阅专家，检查文章观点本身的质量与一致性。",
      [
        "核心观点是否明确（能否用一句话说清）",
        "子观点是否明确",
        "观点是否前后一致（是否存在立场漂移）",
        "观点是否偏离主题",
        "观点是否过度扩大",
        "结论是否引入前文从未出现的新的核心观点",
      ].map((s) => `- ${s}`).join("\n"),
      "指出观点问题所在的具体语句；结论段出现的新论点必须逐条指出。",
    ),
  },
  {
    id: "argument",
    name: "论证",
    en: "Argument",
    color: COLOR.argument,
    description: "论据是否支持论点 · 论据是否不足 · 是否只有结论没有论证（不做事实核查）",
    enabled: true,
    defaultSelected: true,
    order: 2,
    prompt: prompt(
      "你是论证审阅专家，检查论据与论点之间的关系，不进行事实核查。",
      [
        "论据是否支持论点",
        "论据是否不足（单一样本、比例或范围未交代）",
        "推理是否完整（从论据到结论是否缺少环节）",
        "例子是否支持结论",
        "论点和论据是否脱节",
        "是否只有结论没有论证（断言代替论证）",
      ].map((s) => `- ${s}`).join("\n"),
      "引用具体的论据语句；断言式结论要引用该结论本身。",
    ),
  },
  {
    id: "rhetoric",
    name: "修辞",
    en: "Rhetoric",
    color: COLOR.rhetoric,
    description: "措辞 · 句式 · 节奏 · 重复 · 空洞表达 · 过度修饰",
    enabled: true,
    defaultSelected: true,
    order: 3,
    prompt: prompt(
      "你是修辞审阅专家，检查语言表达的质量与力度。",
      [
        "措辞（用词是否准确、是否有更合适的词）",
        "表达力度（语气与内容是否匹配，是否过强或过弱）",
        "句式（句式是否单调、是否可优化）",
        "节奏（长短句配合、行文节奏）",
        "重复（近距离的词语或句式重复）",
        "空洞表达（没有信息量的评价，如「非常好」「非常重要」）",
        "过度修饰（形容词堆叠、夸张修辞）",
        "不自然表达（翻译腔、生硬搭配）",
      ].map((s) => `- ${s}`).join("\n"),
      "修辞问题引用具体的短语或句子，并给出可直接替换的表述建议。",
    ),
  },
  {
    id: "structure",
    name: "结构",
    en: "Structure",
    color: COLOR.structure,
    description: "章节顺序 · 信息组织 · 衔接 · 重复章节（可产生段落级 Finding）",
    enabled: true,
    defaultSelected: true,
    order: 4,
    prompt: prompt(
      "你是结构审阅专家，检查文章的组织与衔接。可以输出段落级 Finding，不限于单句。",
      [
        "章节顺序（章节安排是否合理）",
        "段落顺序（段落之间逻辑位置是否正确）",
        "信息组织（同类信息是否被拆散、无关信息是否混入）",
        "内容衔接（段落之间过渡是否突兀）",
        "开头（是否有效引入主题）",
        "结尾（是否有效收束，是否双重收束）",
        "重复章节（同一内容在不同章节重复出现）",
        "主题跳跃（话题突然切换）",
      ].map((s) => `- ${s}`).join("\n"),
      "段落级问题引用该段中最能代表问题的一句，problem 中说明涉及的是哪个段落（含 L 行号）。",
    ),
  },
  {
    id: "clarity",
    name: "清晰度",
    en: "Clarity",
    color: COLOR.clarity,
    description: "歧义 · 句子过长 · 指代不清 · 啰嗦表达",
    enabled: true,
    defaultSelected: true,
    order: 5,
    prompt: prompt(
      "你是清晰度审阅专家，检查表达是否易于准确理解。",
      [
        "歧义（一句话可以有多种理解）",
        "句子过长（一句话包含过多并列判断或从句）",
        "表达过度抽象（缺少具体指向）",
        "主语不清晰（动作执行者不明）",
        "指代不清晰（「这」「它」「该」指代对象不明）",
        "信息密度过高（一句塞入过多信息点）",
        "不必要的复杂表达（可以用更简单的说法）",
        "啰嗦表达（可以删减而不损失信息）",
      ].map((s) => `- ${s}`).join("\n"),
      "清晰度问题必须引用造成理解困难的具体语句。",
    ),
  },
  {
    id: "speech",
    name: "演讲表达",
    en: "Speech",
    color: COLOR.speech,
    description: "是否适合口语 · 是否第一次就能听懂 · 节奏是否单调（默认禁用）",
    enabled: false,
    defaultSelected: false,
    order: 6,
    prompt: prompt(
      "你是演讲稿审阅专家，检查文稿是否适合口头表达、听众第一次听能否跟上。",
      [
        "句子是否适合口语表达（书面语、长从句）",
        "句子是否过长（口语单句建议不超过 30 字）",
        "信息是否第一次听就容易懂（是否需要回读才能理解）",
        "表达是否重复（口头重复显得啰嗦）",
        "节奏是否单调（句长均匀、缺少强调点）",
        "重点是否清晰（关键信息是否被淹没）",
      ].map((s) => `- ${s}`).join("\n"),
      "以「听众第一次听」为标准判断，不考虑阅读场景。",
    ),
  },
];
