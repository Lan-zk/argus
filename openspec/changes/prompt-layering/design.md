# Design: prompt-layering

## Context

现状审计：内置类别 Prompt 经 `prompt()` 辅助拼接了 SEVERITY_RULES（七类同文通用样板）与 QUOTE_RULES（引用/hash 格式规则，与系统层 OUTPUT_SCHEMA_TEXT 大面积重复）；另有 4 处渲染文案含「MVP」「PRD §n」开发侧信息。动机见 proposal.md。

## Goals / Non-Goals

**Goals:** 格式契约唯一来源为系统层；类别 Prompt 纯审阅要求；新建类别零格式负担自动合规；渲染文案零开发侧信息。

**Non-Goals:** 不改 submit_findings 工具 schema 与校验逻辑；不清理代码注释（非渲染内容）；不做 Prompt 版本迁移（旧存量冗余无害）。

## Decisions

### 1. 契约归位：System Instruction 与 Output Schema 各吸收一块

- SYSTEM_INSTRUCTION 追加「Severity 语义」段（high/medium/low 通用定义，原 SEVERITY_RULES 文案），并补一句"以一次 submit_findings 工具调用返回全部结果"
- OUTPUT_SCHEMA_TEXT 吸收 QUOTE_RULES 的全部增量：长度指引（建议不超过 40 字）、lineHint 填写指引（已有）、段落级问题引用该段最具代表性一句。归一化/djb2 说明原已在此，删除类别层副本即消灭重复

### 2. 类别 Prompt 形态：角色 + 检查项 + 类别指导 + 一行 severity 校准

`prompt()` 辅助删除 SEVERITY_RULES/QUOTE_RULES 参数位，新增 `calibration` 参数（一行本类别如何判 high/low 的校准句，属审阅要求范畴）。七类各写校准（如逻辑「只有动摇核心论证的问题才评 high」、修辞「high 罕见，多为 medium/low」）。存量类别数据不迁移：旧 Prompt 中的重复规则只造成 token 冗余，无正确性影响；「恢复内置」取到精简版。

### 3. 文案净化清单（渲染字符串，4 处）

| 位置 | 现文案 | 改为 |
| --- | --- | --- |
| App.vue 品牌副标 | AI 文稿审阅 · MVP | AI 文稿审阅 |
| NewReview 提示 | ……不修改原文（PRD §2）。 | 去引用保留语义 |
| Settings Models hint | ……不落明文（PRD §21–23） | 去引用保留语义 |
| Settings Categories hint | 修改互不影响（PRD §15–17 §45） | 去引用保留语义 |

另将 Workspace 空态中「批注定位基于行号 + 内容 + hash 三信号」等实现语改写为使用者语。验收以「渲染文案 grep 不到 MVP/PRD/§」为准（测试固化）。

### 4. 测试策略

- prompts.test：SYSTEM_INSTRUCTION 含 severity 语义；OUTPUT_SCHEMA 含段落级引用指引；新增「用户 Prompt 无格式约束 → 组装结果四段完整且含全部契约」场景测试
- default-categories 快照：7 类 Prompt 均不含「djb2/归一化/引用与定位规则/Severity 判断规则」字样，且各含校准行
- 文案测试：挂载三页后 `document.body.textContent` 断言不含 `MVP|PRD|§`（App.test 扩展）

## Risks / Trade-offs

- [旧存量类别 Prompt 保留重复规则] → 无害冗余；用户可「恢复内置」或手动删除
- [模型对 severity 的遵循度变化] → 语义内容未变，仅位置与措辞归并；审阅路径有真实模型联调可复核
- [文案净化误伤功能说明] → 逐处人工复核语义保留

## Migration Plan

无数据迁移。默认类别 Prompt 更新仅影响「恢复内置」与全新安装；快照与文案测试同步更新。

## Open Questions

（无——分层原则与文案净化范围均已与用户确认。）
