## Purpose

定义导入标准 skills 文件夹压缩包（zip）为审阅类别的行为契约：包结构要求、安全校验与排除项、导入即类别映射、同名升级语义，以及包内文件的使用边界。

## ADDED Requirements

### Requirement: 包结构与导入入口

系统 SHALL 支持导入 zip 压缩的标准 skills 文件夹：包内可含一个或多个 skill 目录，每个 skill 目录根下 MUST 存在 `SKILL.md` 且其 frontmatter（至少 name、description）MUST 可解析。不存在任何合法 skill 的包 SHALL 整体拒绝导入并逐项说明原因。

#### Scenario: 多 skill 包导入

- **WHEN** 用户导入含 3 个 skill 目录的 zip，均含合法 `SKILL.md`
- **THEN** 系统识别出 3 个可导入的 skill 并进入确认列表

#### Scenario: 缺 SKILL.md 的目录不计入

- **WHEN** 包内某目录无 `SKILL.md` 或 frontmatter 无法解析
- **THEN** 该目录被跳过并逐项说明原因，其余合法 skill 仍可导入

### Requirement: 安全校验与排除项

导入解包 MUST 在内存完成且 MUST NOT 将包内容写入磁盘。系统 MUST 执行：zip 路径穿越防护（条目路径不得逃出包根、拒绝绝对路径与 `..` 段）、条目数上限、解压总大小上限、单文件大小上限。超限或含恶意路径的包 SHALL 整体拒绝并说明触发的规则。包内 `scripts/` 目录 MUST NOT 被读取或执行，导入结果界面 SHALL 明示其被忽略。

#### Scenario: zip-slip 拒绝

- **WHEN** 包内某条目路径为 `../../evil.md` 或以 `/` 开头
- **THEN** 整包拒绝导入，提示检测到不安全路径

#### Scenario: 超条目上限拒绝

- **WHEN** 包内条目数超过上限
- **THEN** 整包拒绝导入并说明条目数超限

#### Scenario: scripts 目录被明示忽略

- **WHEN** 导入含 `scripts/run.py` 的 skill 包
- **THEN** 导入成功且结果界面显示「scripts/ 未读取」类说明，该文件内容不进入任何提示词

### Requirement: 导入即类别

导入确认后，包内每个合法 skill SHALL 成为一个审阅类别：名称与说明取自 frontmatter，提示词为 `SKILL.md` 正文（经格式冲突清洗）。类别立即可用于审阅，与内置类别同级管理（启停、排序、删除规则一致）。skill 正文超过提示词长度上限时该 skill SHALL 拒绝导入并说明上限值。

导入生成的类别 SHALL 自动归属同一分组：分组名取导入包名，同名分组已存在时 SHALL 复用，MUST NOT 重复创建；分组归属遵循 category-groups 的管理规则（可在设置中改归属、删组回落通用）。同名升级时目标类别的分组归属 MUST NOT 改变。

#### Scenario: skill 成为可审阅类别

- **WHEN** 用户确认导入「学术引用核查」skill
- **THEN** 类别列表出现该类别，可在新建审阅时勾选使用

#### Scenario: 按包名建组

- **WHEN** 用户导入「小说审阅包.zip」并确认新建 3 个类别
- **THEN** 系统创建（或复用）名为「小说审阅包」的分组，3 个类别归入该组并在 New Review 组切换器中呈现

#### Scenario: 升级不改分组

- **WHEN** 用户导入的 skill 与「小说审阅包」分组下某类别同名升级
- **THEN** 该类别仍归属原分组，仅提示词与说明更新

#### Scenario: 超长正文拒绝

- **WHEN** 某 skill 正文超过提示词长度上限
- **THEN** 该 skill 被拒绝导入，提示正文长度与上限值

### Requirement: 同名升级语义

导入的 skill 与现有类别同名时 SHALL 视为升级：追加为该类别的新提示词版本，历史版本 MUST NOT 被覆盖或删除；类别说明（description）更新为新版 frontmatter 值，其余属性（颜色、顺序、启用状态）保持不变。同名判定规则（frontmatter name 匹配）SHALL 在导入确认界面明示。

#### Scenario: 升级不覆盖历史

- **WHEN** 用户导入与现有「学术引用核查」同名的新版 skill
- **THEN** 该类别提示词新增一个版本，旧版本仍可在版本历史中查看与回退

### Requirement: 格式冲突清洗

导入时系统 SHALL 从 skill 正文中剥离与系统输出格式冲突的内容（指示输出 JSON 结构、返回字段、引用格式、hash 算法等数据格式约束的段落），清洗结果与剥离内容 SHALL 在导入确认界面分别展示，用户确认后以清洗版进入类别提示词。

#### Scenario: 输出格式说明被剥离并明示

- **WHEN** skill 正文含「输出一个 JSON 数组，字段包括 quote/hash…」段落
- **THEN** 该段落在导入确认界面被标注为已剥离，进入提示词的是清洗后版本
