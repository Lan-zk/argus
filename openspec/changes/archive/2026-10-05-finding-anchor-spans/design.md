# finding-anchor-spans — 技术设计

## Context

见 proposal「Why」。现状约束：`Finding` 的锚定字段是单组 `(blockId, startOffset, endOffset, line)`，sqlite `findings` 表为同构宽列（`quote / line_hint / content_hash / line / block_seq / start_offset / end_offset / anchor_status`）；三信号锚定 `anchorOne` 以单条 quote 在单 block 内做归一化内容匹配；Output Schema 的 quote 规则（≤40 字、禁跨段）由系统层内置，类别 Prompt 不携带格式契约；去重键 = 归一化 quote 相同 + 标题相同 + problem 高度相似；渲染按块内区间切片（u1/u2/u3 叠加下划线）。降级保护：库 user_version 高于应用上限时 Repo 只读。

## Goals / Non-Goals

**Goals:**

- 三种批注粒度统一共存：短句（现状不变）、连续大段（行范围主锚）、首尾多点（主锚 + 引用锚）
- 每个锚仍走逐字短引用三信号验证，锚定可靠性不因粒度扩大而下降
- 不返回新字段的模型输出（含全部既有类别与 mock）行为与现状完全一致
- 旧数据/旧库双向兼容：新版本读旧库无损，旧版本读新库仍可显示主锚

**Non-Goals:**

- 不允许模型逐字引用整段长文本（长引用改写风险高，一律以"范围 + 代表句"表达大段）
- 不做跨 Finding 的关联分组（引用锚已覆盖关系型表达，不引入 finding-links）
- 不做按类别的硬性开关（格式契约系统内置，类别不可枚举；使用条件写进契约文案）
- 不改块模型、行号契约、钥匙串、AI 调用机制

## Decisions

### D1：模型输出采用增量字段，主锚沿用既有三字段

- 备选：全新嵌套 `anchors` 数组替换 `quote/lineHint/contentHash` —— 否决：结构化输出 schema 大改牵连 normalizer 修复链、快照测试与既有全部类别，且任何不适应新格式的模型直接全量失败
- **选定**：`quote / lineHint / contentHash` 语义不变（即主锚代表句）；新增可选字段：
  - `span: { fromLine, toLine }` —— 主锚为行范围时提供；代表句 quote 必须落在范围内
  - `refs: [{ quote, lineHint, contentHash }]` —— 引用锚，最多 2 条，每条与主锚 quote 同规则
- 缺省行为：不返回 `span` → 主锚为句级（现状）；不返回 `refs` → 无引用锚（现状）。契约文案限定使用场景："仅当问题本身涉及多处原文或整段结构时"

### D2：领域模型 `Finding.anchors`，持久化"旧列投影 + 新列 JSON"

- TS 侧 `Finding` 新增 `anchors: FindingAnchor[]`，旧五字段（`quote/lineHint/contentHash` 语义 + `blockId/startOffset/endOffset/line/anchorStatus`）废弃为**主锚只读投影**，由写入侧（normalizer/锚定后）同步镜像，读取侧不再独立消费
- `FindingAnchor`：`{ role: "primary" | "ref", quote, lineHint?, contentHash?, blockId?, startOffset?, endOffset?, line?, fromLine?, toLine?, anchorStatus }`
- 存储：`ALTER TABLE findings ADD COLUMN anchors_json TEXT`（user_version +1 迁移 + golden fixture）。选 JSON 列而非规范子表——读取模式是按 round 全量载入内存（`listFindings`），无按锚反查需求
- 双向兼容：写入时旧列继续写主锚投影 → 旧版本 app 读新库仍得到可显示的主锚（符合降级保护方向）；新版本读旧库（`anchors_json` 为 NULL）→ 合成主锚单元素数组

### D3：逐锚定位，主锚范围与代表句互验

- 主锚句级定位 = 现有 `anchorOne` 原样复用（每个锚独立跑，包括 ref）
- `span` 互验：代表句内容命中行必须落在 `[fromLine, toLine]` 内，否则以内容命中为准并 clamp/记日志；范围越界 clamp 到文档实际行数；行范围主锚的渲染区间 = 覆盖该行范围的全部块（首块起点到末块终点），写入 anchors 时回写 clamp 后的 fromLine/toLine
- 防滥用硬校验（normalizer 层）：行范围超过文档总行数 1/2 或超过 120 行时，降级为代表句所在块的范围并记日志
- 降级规则：主锚 unanchored → 整条 Finding unanchored（现有通道，右侧显示、左侧无高亮）；ref unanchored → Finding 与主锚高亮保留，该 ref 标注「引用未定位」（批注文字内呈现）；`refs` 超过 2 条截断并记日志

### D4：渲染三层样式，交互归属同一条批注

- 句级（现状）：块内切片 + 类别色下划线叠加（u1/u2/u3 不变）
- 行范围主锚：覆盖块整块柔和背景（层级在句级下划线之下，可共存）；块 wrapper 加 `data-finding-ids`，点击冒泡走现有 `highlight-click`
- 引用锚：块内切片 + 弱化样式（浅色/虚线类下划线，样式取值实施时走 DESIGN-GUIDE 双主题四组合 + 对比度门禁）
- 点击任一锚（句级/范围块/引用锚）→ 打开同一条批注弹层；右侧批注点击 → 滚动定位到主锚（范围主锚定位首个覆盖块）
- 报告视图与批注列表：引用锚以"L{n} 引用"条目呈现于批注详情内，unanchored 引用显示「引用未定位」

### D5：去重键切换为主锚

- 归一化 quote 比较、标题相同、problem 相似度三项均改以**主锚代表句**为键；refs 不参与去重键（两条主锚相同、引用不同的批注是重复，应当合并）

## Risks / Trade-offs

- [模型不稳定输出 span/refs] → 字段全部可选：缺失即现状行为，无错误定位路径；refs 失败不连累主批注
- [模型把大半篇标成范围，高亮失去分辨力] → D3 硬校验（行数上限 + 占比上限）降级 clamp 并记日志
- [视觉噪音：一条批注多处高亮] → 引用锚弱样式 + 数量上限 2；范围用底色不用下划线，与句级叠加可区分
- [旧列投影双写的不一致] → 投影只由单一写路径（锚定完成后）生成，读取侧单一来源 `anchors`；增加一致性单测（投影字段 === 主锚字段）
- [prompt 快照测试连锁修改] → tasks 中显式列出快照更新项

## Migration Plan

1. user_version 迁移：`ADD COLUMN anchors_json TEXT`（可空，幂等 IF NOT EXISTS 语义）；追加含 anchors 的 golden fixture 与各历史版本回归
2. 读写路径切换：写入双写（旧列投影 + JSON），读取以 anchors 为源、旧列仅在 NULL 时合成
3. 回滚安全：列可空、旧列投影完整，回退版本后数据仍可显示主锚；无数据回填需求
4. 实施 sequencing：domain（types/anchor/normalizer/dedup/prompts）→ repo 迁移 → DocViewer/报告 → 快照与集成测试

## Open Questions

- 引用锚与行范围的具体视觉取值（双主题 × 明暗四组合）：实施时按 DESIGN-GUIDE 流程定稿并跑对比度门禁
- 行范围上限数值（120 行 / 50%）是否需要按真实文稿校准：首个真实使用反馈后调整，仅改常量不动结构
