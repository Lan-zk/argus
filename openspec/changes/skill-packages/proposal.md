## Why

类别提示词没有版本历史与回退——修改即覆盖，想退回之前的版本无从谈起；同时「审阅时调用 skill」的更复杂审阅逻辑，需要比单字段提示词更丰富的载体。以标准 skills 文件夹（SKILL.md + 参考文件）打包为 zip 导入、落地为审阅类别（提示词包形态），既复用既有 skill 生态，又让提示词获得版本化管理。

## What Changes

- 新增 zip 导入：标准 skills 文件夹压缩包（含一个或多个 skill，每个 skill 一个目录，根为 `SKILL.md`）
- **导入即类别**：包内每个 skill 成为一个新审阅类别（名称/说明取自 frontmatter，提示词取正文），并按包名自动归属同一类别分组（依赖 `category-groups`，同名分组复用，不重复建组）；不建独立 skill 库层
- **同名升级**：导入的 skill 与现有类别同名时视为升级，追加为该类别的新提示词版本，MUST NOT 覆盖历史版本
- **安全校验**：zip 路径穿越（zip-slip）防护、条目数与解压总大小上限、`SKILL.md` 必须存在、frontmatter 必须可解析；包内 `scripts/` 目录不读取、不执行，导入时明示忽略
- **格式冲突清洗**：skill 正文中与系统输出格式冲突的「输出格式/返回字段」类说明被剥离并提示，MUST NOT 进入提示词
- **提示词长度上限**：正文超过上限的 skill 拒绝导入并说明原因
- **类别提示词版本化（版本历史与回退 UI）**：store 层「保存即追加不可变版本」已由 review-versioning 提前落地（消除过渡期版本指针失真），本 change 提供版本历史列表与一键回退（回退 = 把旧版内容复制为最新版本），并接入 skill_import 来源
- **回退只影响未来**：已审轮次快照冻结不受版本变更与回退影响（依赖 review-versioning）

## Capabilities

### New Capabilities

- `skill-packages`: zip 导入标准 skills 文件夹的行为契约：包结构要求、安全校验与排除项、导入即类别映射、同名升级语义

### Modified Capabilities

- `settings`: Prompt 编辑器需求扩展——保存即追加不可变版本、版本历史与回退操作、回退影响范围（仅未来轮次）

## Impact

- **依赖**：新增 `fflate`（内存解包 zip）；`tauri-plugin-dialog` 复用（选 zip，随 document-import 引入，实施顺序在其后）；类别分组能力（`category-groups`：组表与归属，导入类别按包名建组）
- **代码**：`src/lib/skill-import/`（解包/校验/清洗/映射）；设置页「审阅类别」区增「导入 Skill 包」入口，导入确认为设置内对话框（不进顶层导航）；类别编辑区内增版本历史展开项（store 层版本化改造在 review-versioning，此处回归断言）
- **数据**：依赖 `review-versioning` 里程碑 0 的 `category_prompt_versions` 表（append-only）；本 change 不新增表
- **实施顺序**：review-versioning → document-import → category-groups → 本 change（版本表、dialog 能力、类别分组）
