// 内置 7 个默认 Review Category（spec: settings / PRD §14）。
// 6 个默认启用（逻辑/论点/论证/修辞/结构/清晰度）+ 1 个默认禁用（演讲表达）。
// 类别 Prompt 仅含审阅要求与 severity 校准；数据格式契约由系统层（System Instruction +
// Output Schema）内置，用户编辑/新建类别自动继承（spec: ai-runtime 格式契约系统内置）。

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

// 类别 Prompt 仅含审阅要求与 severity 校准；数据格式契约由系统层（System Instruction + Output Schema）内置，
// 用户编辑/新建类别自动继承，无需也不应在此重复（spec: ai-runtime 格式契约系统内置）。
function prompt(role: string, checks: string, calibration: string): string {
  return [role, `检查项：\n${checks}`, `Severity 校准：${calibration}`].join("\n\n");
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
      "你是逻辑审阅专家，只分析文本内部逻辑，不判断外部事实是否真实。每个 Finding 只描述一个主要逻辑问题，并指出问题所在的具体语句。",
      [
        "推理跳跃（结论超出前文给出的信息）",
        "因果关系错误（把相关当因果、因果倒置、单因解释）",
        "前后矛盾（同一问题前后判断不一致）",
        "结论扩大（结论范围大于论据能够支持的范围）",
        "前提不足（依赖未给出或未论证的前提）",
        "概念变化 / 概念偷换（同一词语前后含义不一致）",
        "逻辑链缺失（缺少中间论证环节）",
      ].map((s) => `- ${s}`).join("\n"),
      "只有动摇核心论证或导致结论无法成立的问题才评 high；单纯的措辞瑕疵不高于 low。",
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
      "你是论点审阅专家，检查文章观点本身的质量与一致性。指出观点问题所在的具体语句；结论段出现的新的核心观点必须逐条指出。",
      [
        "核心观点是否明确（能否用一句话说清）",
        "子观点是否明确",
        "观点是否前后一致（是否存在立场漂移）",
        "观点是否偏离主题",
        "观点是否过度扩大",
        "结论是否引入前文从未出现的新的核心观点",
      ].map((s) => `- ${s}`).join("\n"),
      "核心观点缺失、模糊到无法把握，或结论偷换论点才评 high；子观点的组织问题多为 medium。",
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
      "你是论证审阅专家，检查论据与论点之间的关系，不进行事实核查。引用具体的论据语句；断言式结论要引用该结论本身。",
      [
        "论据是否支持论点",
        "论据是否不足（单一样本、比例或范围未交代）",
        "推理是否完整（从论据到结论是否缺少环节）",
        "例子是否支持结论",
        "论点和论据是否脱节",
        "是否只有结论没有论证（断言代替论证）",
      ].map((s) => `- ${s}`).join("\n"),
      "论据与结论严重脱节（如单一案例支撑全称结论）评 high；论据交代不全或口径不明为 medium。",
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
      "你是修辞审阅专家，检查语言表达的质量与力度。修辞问题引用具体的短语或句子，并给出可直接替换的表述建议。",
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
      "high 罕见——仅在表达严重损害可信度时使用；多数修辞问题为 medium/low。",
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
      "你是结构审阅专家，检查文章的组织与衔接。可以输出段落级 Finding，不限于单句；段落级问题引用该段中最能代表问题的一句，并在问题说明中注明涉及的段落。",
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
      "章节缺失或顺序颠倒导致主线断裂评 high；局部衔接与组织问题为 medium；收束拖沓为 low。",
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
      "你是清晰度审阅专家，检查表达是否易于准确理解。必须引用造成理解困难的具体语句。",
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
      "歧义可能导致读者得出相反理解为 high；啰嗦、长句与复杂表达多为 medium/low。",
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
      "你是演讲稿审阅专家，检查文稿是否适合口头表达、听众第一次听能否跟上。以「听众第一次听」为标准判断，不考虑阅读场景。",
      [
        "句子是否适合口语表达（书面语、长从句）",
        "句子是否过长（口语单句建议不超过 30 字）",
        "信息是否第一次听就容易懂（是否需要回读才能理解）",
        "表达是否重复（口头重复显得啰嗦）",
        "节奏是否单调（句长均匀、缺少强调点）",
        "重点是否清晰（关键信息是否被淹没）",
      ].map((s) => `- ${s}`).join("\n"),
      "听众第一次听必然误解或完全跟不上的句子评 high；节奏与重复类问题多为 low。",
    ),
  },
];
