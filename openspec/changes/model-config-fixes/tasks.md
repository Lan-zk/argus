# Tasks: model-config-fixes

依赖顺序执行；规格引用写作 `spec:<capability>`。

## 1. 端点读取与预设补回

- [ ] 1.1 `model-discovery.ts` 增 `presetEndpoint(providerId)`（model 级优先 / provider 级兜底），`presetFetchInput` 改用之；单测覆盖 opencode（model 级）与 deepseek（provider 级）两形态
- [ ] 1.2 `presets.ts` 补回 5 个预设（opencode/opencode-go/kimi-coding/meta/radius，分组 15/13/6）；快照测试更新为 34 项并新增「每个预设可解析非空端点」断言
- [ ] 1.3 `client.ts` 手动输入 fallback 改按目录主流 api 家族推断（并列取首项）；单测覆盖 opencode 混合目录与 deepseek 单一目录两路径

## 2. displayName 字段（spec:settings 显示名称场景）

- [ ] 2.1 `types.ts` 增 `displayName?`；`persistence.ts` sanitize 透传 + trim 空串归一；单测覆盖持久化往返与空串等价未设置
- [ ] 2.2 SettingsPage：列表行 displayName 优先（回退「服务名 · 模型 ID」）；自定义连接表单、编辑表单、预设高级折叠各增「显示名称」输入（placeholder=回退值）；组件测试覆盖优先展示、回退、编辑保存
- [ ] 2.3 store 保存链路透传 displayName（addModel/updateModel）；单测覆盖编辑改名不影响其他字段

## 3. 勘误与交付

- [ ] 3.1 `docs/known-issues.md` 第 8 条勘误（5 项误判补回、github-copilot 真实排除理由、两条调查方法教训）；README 预设数量同步 34
- [ ] 3.2 交付检查：vitest 全绿、`vue-tsc` 干净、组件/快照测试含新断言；`openspec validate` 通过
