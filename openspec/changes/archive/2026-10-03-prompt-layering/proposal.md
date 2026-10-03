# Change: prompt-layering

## Why

两类混杂问题：① 内置类别 Prompt 中混入大段数据格式约束（severity 通用定义、引用/hash 规则），后者还与系统层 Output Schema 大面积重复——用户新建类别若不照抄这些规则，格式契约即丢失，用户改坏即破坏结构化输出；② 前端页面文案携带开发侧信息（「MVP」「PRD §2」等章节引用），使用者不应需要知道当前版本阶段或需求文档编号。

## What Changes

- **格式契约上移系统层**：Severity 通用语义定义并入 System Instruction；引用规则（逐字引用、长度指引、行号、段落级引用代表句）并入 Output Schema；两者均为系统内置、用户不可编辑，所有类别（含用户新建）自动继承
- **类别 Prompt 瘦身为纯审阅要求**：7 个内置类别的默认 Prompt 移除 SEVERITY_RULES/QUOTE_RULES 样板，各保留一行类别特有的 severity 校准说明；用户层不再需要、也不再建议携带任何数据格式约束
- **核心保证**：用户 Prompt 不含任何数据格式约束时，调用输入与输出校验仍完全合规（格式契约唯一来源为系统层）
- **前端文案净化**：渲染到页面的文案 MUST NOT 出现 MVP、PRD 及章节编号、规格引用、开发进度、原型/设计来源等开发侧信息；相关提示改为面向使用者的表述
- 与 PRD §13 字面的偏差记录：severity「通用定义」上移系统层，类别层保留校准性判断（更符合"审阅要求"语义，视为对 PRD 意图的忠实执行）

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `ai-runtime`: ADDED「格式契约系统内置」requirement——System Instruction 含 severity 通用语义、Output Schema 含完整数据格式契约、用户 Prompt 无格式约束时输出仍合规
- `review-ui`: ADDED「文案面向使用者」requirement——页面渲染文案不得含开发侧信息（MVP/PRD/§/进度/原型）
- `settings`: MODIFIED「Review Category 管理」——内置类别默认 Prompt 仅包含审阅要求与类别校准，不含数据格式约束

## Impact

- **代码**：`src/domain/prompts.ts`（SYSTEM_INSTRUCTION/OUTPUT_SCHEMA_TEXT 增补）、`src/domain/default-categories.ts`（Prompt 瘦身+校准行）、`src/App.vue`/`src/pages/*.vue`（4 处文案净化）、相关测试
- **兼容性**：已保存的旧类别 Prompt 嵌有旧规则仅造成冗余、无害；「恢复内置类别」拿到精简版；四段组装结构不变，现有调用链零改动
- **范围边界**：不改 Structured Output 工具 schema 与校验逻辑本身；代码注释中的开发引用不在清理范围（非渲染内容）
