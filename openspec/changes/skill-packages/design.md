# skill-packages — 技术设计

## Context

见 proposal「Why」。现状约束：`ReviewCategory.prompt` 是平面字符串，`updateCategory` 直接覆盖写，无任何版本痕迹；系统提示词与输出 schema 为硬编码常量（`src/domain/prompts.ts`），skill 只能填「类别提示词」槽位；用户决策已定：提示词包形态（非智能体级）、导入即类别（无 skill 库层）。本 change 依赖 `review-versioning` 里程碑 0 的 `category_prompt_versions` 表、`document-import` 引入的 dialog 能力，以及 `category-groups` 的类别分组表与归属操作。

## Goals / Non-Goals

**Goals:**

- zip 导入 → 校验 → 清洗 → 确认 → 类别（或同名升级）一条链路闭环
- 提示词版本化统一覆盖两条来源：skill 导入与设置页手动编辑，共用一张 append-only 表
- 安全边界清晰：内存解包、zip-slip 防护、大小上限、scripts/ 永不读取执行

**Non-Goals:**

- 不做 skill 库/绑定层、不执行包内脚本（智能体级演进留待未来，包格式已兼容）
- 不做 references/ 参考文件的提示词拼接（token 风险，v1 列为忽略并明示）
- 不做 skill 编写引导/模板（用户从外部获取或自写 zip）
- 不改系统提示词与输出 schema 的硬编码地位

## Decisions

### D1：包格式识别 — 标准 skills 文件夹约定，manifest 可选

- 包根直接是若干 skill 目录（`<name>/SKILL.md`）；也接受包根即单个 skill（根下有 `SKILL.md`）
- frontmatter 解析 `name`、`description`（缺一不可）；正文为提示词全文
- 无 manifest 要求（skills 生态无此约定）；checksum 等溯源信息记入 `skill_meta` JSON 列（zip 内路径、条目摘要）而非强校验
- 上限初值：条目 ≤ 200、解压总大小 ≤ 5 MB、单文件 ≤ 1 MB、提示词正文 ≤ 12 000 字符（常量集中定义，便于调整）

### D2：内存解包与安全校验 — fflate，先按头部预检再解压

- `fflate` 异步 `unzip` + filter 回调：**先读 zip central directory 头部的 originalSize 做解压总量预检**（`unzipSync` 会先整体 inflate 完才能检查，解压炸弹防护失效，不可用）；预检通过才实际解压到内存 Map<path, Uint8Array>，不落盘（spec 要求）
- 校验顺序：路径规范（拒绝绝对路径 / `..` 段 / 反斜杠混淆）→ 条目数 → 头部解压总大小预检（超限即弃，未 inflate）→ 找 skill 目录 → frontmatter 解析；解压后逐条目复核实际大小
- 任何「整包级」违规（路径穿越、条目超限、预检超限）拒绝整包；「条目级」问题（某目录无 SKILL.md）跳过该 skill 并列入报告——与 spec 两类场景对应

### D3：同名判定与升级映射

- 匹配键：frontmatter `name` 与现有类别 `name` 全等（trim）
- 命中 → `INSERT category_prompt_versions (source='skill_import', skill_meta)` + `UPDATE categories.current_version`；未命中 → 新建类别（颜色走现有轮转分配，`default_selected=false`，`enabled=true`）
- 新建类别的分组归属（category-groups 落地的组表）：按导入包名（zip 文件名去扩展名）查找同名分组，命中复用、未命中新建并置末位，本次导入全部新建类别归入该组；同名升级 MUST NOT 改变目标类别的既有分组归属（升级只动提示词与说明）
- 导入确认界面按 skill 逐行列出：新建 / 升级（目标类别名）/ 拒绝（原因），用户可勾选部分导入

### D4：格式冲突清洗 — 规则式剥离，双向展示

- 检测规则：段落含「输出 JSON / 返回字段 / quote|hash|offset 字段说明 / 按以下格式返回」等模式（规则表常量化，从现有 `SYSTEM_INSTRUCTION` 与 schema 描述反推关键词）
- 剥离按段落边界，不切割句子；清洗版与被剥离段落并列展示，用户确认后落库清洗版
- 保守取向：宁可多标注疑似冲突交用户确认，MUST NOT 让格式指令混进提示词破坏 findings 解析

### D5：版本化分工 — 手动编辑已由 review-versioning 落地，本 change 补 skill 来源与 UI

- 「设置页保存 Prompt 即追加 manual_edit 版本」及 `duplicateCategory`/「恢复内置类别」的版本化已并入 review-versioning（其任务 2.4），避免过渡期 `runs.category_version` 失真；本 change 只做：版本历史 UI（版本/来源/时间 + 回退）、skill_import 来源与 skill_meta、回退的 rollbackFrom 记录
- 版本历史 UI：类别编辑区内可展开列表（版本、来源图标 builtin/manual/skill、时间）+ 「回退」= 复制旧版为新版本（source='manual_edit'，skill_meta 记 `rollbackFrom`）
- 与 review-versioning 的衔接：`runs.category_version` 已冻结每轮所用版本，回退对历史轮次零影响由该机制天然保证

## Risks / Trade-offs

- [清洗规则误伤合法内容（如审阅「数据格式规范」类文档的 skill）] → 剥离项全部明示 + 用户确认；规则表常量化易迭代
- [12k 字符上限可能挡住部分长 skill] → 上限常量可调；拒绝信息给出实际长度与上限值
- [同名判定靠 name 全等，重名不同 skill 误升级] → 确认界面明示将升级的目标类别与版本差异，用户可取消勾选
- [references/ 被忽略导致 skill 效果打折] → 导入结果明示忽略清单；渐进拼接留作未来增强（包格式无需变更）

## Migration Plan

无自有存储迁移（版本表由 review-versioning 建立，分组表由 category-groups 建立）。存量类别在版本表补种 v1（source='builtin'）已由 review-versioning 首迁覆盖。实施顺序：review-versioning → document-import → category-groups → 本 change。

## Open Questions

- 清洗规则关键词表的初始集合 —— 实现期用数个真实 skill 样本校准，规则表结构与流程不变
