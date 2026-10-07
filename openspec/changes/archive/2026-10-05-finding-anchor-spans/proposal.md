## Why

当前整条批注链路把锚定粒度锁死在"≤40 字单句、单 block 内"：Output Schema 明确禁止整段与跨段引用（`src/domain/prompts.ts` OUTPUT_SCHEMA_TEXT）、三信号锚定只在单个 block 内做内容匹配（`src/domain/anchor.ts`）、`Finding` 数据模型只承载一个 `(blockId, startOffset, endOffset)`（`src/domain/types.ts`）、DocViewer 只会按块内切片画高亮。而逻辑（结论扩大、前后矛盾）、节奏（整节句长均匀）、演讲表达（缺少强调点）、结构（段落顺序、衔接）这些类别的问题本质是**大段连续**或**首尾多点**的，PRD §14.5 也早已预期「Structure Review 可以产生段落级 Finding，Finding 不一定必须对应单个句子」——产品意图存在，实现未接住：段落范围目前只能压缩为"一句代表句 + 文字描述"，高亮范围与问题实际范围不一致。

## What Changes

- **锚定模型升级为 anchors 列表**：一条 Finding = 1 个主锚（primary）+ 最多 2 个引用锚（ref）。主锚回答"错在哪"，可以是短句（现状）或**行范围**（fromLine–toLine，覆盖连续大段）；引用锚回答"相对于哪里错"，仅允许逐字短句（如结论扩大时钉住远处的论据/铺垫句）
- **引用规则扩展但可靠性不降级**：每个锚的 quote 仍逐字、仍守短引用约束，行范围以"范围 + 范围内代表句"互验；三信号机制逐锚独立执行，不引入长引用
- **逐锚独立降级**：主锚锚定失败 → 整条 Finding 走现有 unanchored 通道（右侧显示、左侧无高亮）；引用锚失败 → Finding 正常保留与高亮，该引用在批注内标注「引用未定位」
- **渲染与交互**：主锚实色高亮（短句=现有下划线叠加，行范围=整行柔和背景）；引用锚弱化样式（浅色/虚线）；点击任一锚打开同一条批注，右侧批注点击定位到主锚；既有"同句多批注叠加"（u1/u2/u3）行为不变
- **同类去重键从 quote 改为主锚**，避免多锚批注被误合并
- **兼容**：旧 Finding（单 quote）读写为主锚单元素形态；SQLite 走 user_version 迁移 + golden fixture

## Capabilities

### New Capabilities

（无——本变更为既有批注管线的演进）

### Modified Capabilities

- `ai-runtime`: Output Schema 引用契约扩展——新增行范围 scope 与可选引用锚字段（数量上限、角色规则、逐字短引用约束不变），System Instruction 补充"关系型问题"的使用场景说明
- `finding-pipeline`: 三信号定位从"单 quote 单锚"扩展为"多锚逐锚定位"：主锚行范围解析与代表句互验、引用锚定位、逐锚降级规则、去重键变更
- `review-ui`: 左侧原文渲染新增行范围整行背景与引用锚弱化样式；双向定位交互（任一锚 ↔ 同一条批注）与报告/批注列表中的引用位置呈现
- `app-persistence`: Finding 持久化 schema 增加 anchors 结构（user_version 迁移），旧数据单向兼容读入为主锚形态

## Impact

- **代码**：`src/domain/types.ts`（Finding 结构）、`anchor.ts`（多锚定位）、`prompts.ts`（契约文案）、`normalizer.ts`（新字段校验与修复）、`dedup`（去重键）；`src/components/DocViewer.vue`（第三种 span 形态渲染）；`src/stores/session.ts`；`src/lib/repo/`（迁移 + fixtures）
- **数据**：SQLite Finding 表迁移（含 golden fixture 矩阵，按 app-persistence 存储纪律），历史数据无破坏性改写
- **风险**：模型输出多锚结构的稳定性——缓解为引用锚"可选且可失败"，缺失或错锚不产生错误定位、不连累主批注；行范围与代表句互验失败时按主锚降级规则处理
- **不改动**：块模型与行号契约（parseBlocks）、钥匙串、AI 运行时调用机制、既有单句批注的任何行为
