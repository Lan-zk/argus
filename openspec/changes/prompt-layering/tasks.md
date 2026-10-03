# Tasks: prompt-layering

依赖顺序执行；规格引用写作 `spec:<capability>`。

## 1. 格式契约上移（spec:ai-runtime 格式契约系统内置）

- [x] 1.1 `prompts.ts`：SYSTEM_INSTRUCTION 追加 Severity 通用语义段与「一次 submit_findings 工具调用返回」总则；OUTPUT_SCHEMA_TEXT 吸收引用规则增量（长度指引、段落级引用代表句）；单测覆盖两段新内容
- [x] 1.2 `default-categories.ts`：`prompt()` 移除 SEVERITY_RULES/QUOTE_RULES，新增 calibration 参数；7 类各写一行 severity 校准；快照单测断言全部默认 Prompt 不含「djb2/归一化/引用与定位规则/Severity 判断规则」且各含校准行
- [x] 1.3 新增场景测试：用户 Prompt 为纯审阅要求（零格式约束）时，`assemblePrompt` 组装结果四段完整、系统层契约齐全（spec:ai-runtime 用户类别无格式约束仍合规）

## 2. 前端文案净化（spec:review-ui 文案面向使用者）

- [x] 2.1 清理 4 处渲染文案（App 品牌副标去「MVP」；NewReview/Settings×2 去「PRD §n」保留语义）；Workspace 空态实现语改写为使用者语；全仓 `*.vue` 渲染内容 grep 验证无 MVP/PRD/§
- [x] 2.2 App.test 扩展：挂载后 `document.body.textContent` 断言不含 MVP/PRD/§（含三页切换遍历）

## 3. 交付

- [x] 3.1 交付检查：vitest 全绿、`vue-tsc` 干净、`openspec validate` 通过；known-issues 记录（PRD §13 偏差说明、存量类别冗余无害）
