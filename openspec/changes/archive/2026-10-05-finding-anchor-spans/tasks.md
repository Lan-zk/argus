# finding-anchor-spans — 任务清单

## 1. 领域层（domain，纯函数 + 同目录单测）

- [x] 1.1 `types.ts` 新增 `FindingAnchor`（role/scope 语义：primary|ref、quote|range）与 `Finding.anchors`；旧锚定字段改为主锚只读投影并注明；`npm test -- src/domain` 通过（含既有测试零回归）
- [x] 1.2 `anchor.ts` 拆出逐锚定位入口：主锚句级 = 现有逻辑原样；行范围互验（命中行必须在 span 内、越界 clamp、>120 行或 >文档 1/2 收敛到所在块）+ 覆盖块区间计算；单测覆盖互验失败收敛、越界、防滥用三条路径
- [x] 1.3 引用锚定位：复用逐锚入口、≤2 截断记日志、ref 未命中不连累主锚（Finding 级 anchorStatus 只由主锚决定）；单测覆盖 ref 成功/失败/截断
- [x] 1.4 `normalizer.ts`：span/refs 字段校验与修复（非法行号、超量截断、缺失字段丢弃该锚并记日志）；不返回新字段时输出与现状逐字节等价（快照断言）
- [x] 1.5 `dedup` 去重键切换为主锚 quote；单测：主锚相同 refs 不同合并、主锚不同 refs 相同不合并
- [x] 1.6 `prompts.ts` 契约文案扩展（span/refs 规则、使用场景限定、数量上限）+ System Instruction 补充；prompt 快照测试更新

## 2. 持久化（repo）

- [x] 2.1 user_version 迁移：findings 表追加 anchors 存储（可空，幂等可重放）；golden fixture 追加含 span/refs 的新样本与各历史版本回归；迁移重复执行不产生重复列（幂等测试）
- [x] 2.2 读写路径：写入双写（既有列 = 主锚投影 + 新结构），读取以 anchors 为源、NULL 时合成主锚单元素；投影一致性单测（投影字段 === anchors[primary]）；旧数据读入回归（重构前旧 fixture 全通过）
- [x] 2.3 旧版本兼容验证：以"只含既有列"的读取路径（模拟旧版应用）读迁移后数据，主锚显示无损

## 3. UI 与交互

- [x] 3.1 DocViewer：行范围主锚渲染（覆盖块整行柔和背景，与句级下划线叠加共存、层次可区分）；点击范围块走既有 highlight-click；组件测试覆盖共存与点击归属
- [x] 3.2 引用锚渲染（弱化样式：双主题 × 明暗四组合取值按 DESIGN-GUIDE 定稿，改令牌后跑 `node scripts/contrast-check.mjs`）；点击引用锚打开同一条批注
- [x] 3.3 双向定位更新：右侧卡片点击定位主锚（范围主锚定位首个覆盖块）；悬停联动覆盖三种锚形态；WorkspacePage 集成测试
- [x] 3.4 Finding 卡片与 ReportView：列出引用锚行号、未定位引用标注「引用未定位」；组件测试

## 4. 集成与验收

- [x] 4.1 mock 端点联调：`scripts/mock-openai-server.mjs` 增加返回 span/refs 的样例响应；全链路（Prompt → 结构化输出 → 规范化 → 多锚定位 → 渲染）冒烟通过
- [x] 4.2 `npm test` 全量 + `cargo test` 通过；快照测试（presets / prompts）更新完毕
- [ ] 4.3 真机 `npm run tauri dev` 手动验收：逻辑类大段批注（行范围）、结论扩大型双点批注（主锚+引用锚）、旧会话恢复显示不回退
- [x] 4.4 同步文档：`src/domain/README.md`、`openspec` 相关 README 若有锚定描述则更新
