# skill-packages — 任务清单

## 1. 解包与安全校验

- [ ] 1.1 集成 `fflate`：`src/lib/skill-import/unpack.ts` 内存解包为 Map（**异步 unzip + central directory 头部 originalSize 预检防解压炸弹，不用 unzipSync**）；zip 文件读取复用 document-import 引入的 plugin-fs `readFile`（dev 模式走 `<input type=file>`）；安全校验（绝对路径/`..` 段拒绝、条目数、预检+复核解压总大小、单文件上限，常量集中定义）；单测覆盖 zip-slip 样例、解压炸弹样例（头部超限未 inflate 即弃）、超限样例、合法样例
- [ ] 1.2 skill 目录识别（包根多 skill / 包根单 skill 两种形态）+ frontmatter 解析（name/description 必填）；条目级问题跳过并产出报告；单测覆盖混合包（2 合法 + 1 缺 SKILL.md + 1 frontmatter 残缺）

## 2. 清洗与导入映射

- [ ] 2.1 格式冲突清洗（规则表常量 + 段落边界剥离）；输出清洗版与剥离清单；单测覆盖含输出格式说明的 skill 与不含的正常 skill（零误伤断言）
- [ ] 2.2 导入映射：同名升级（追加 skill_import 版本 + 前移 current_version）/ 新建类别（默认色轮转、非默认选中）；新建类别按包名查找/新建分组并归入（复用同名组，升级不改目标类别分组，依赖 category-groups）；提示词长度上限拒绝；`skill_meta` 记录 zip 内路径与来源信息；单测覆盖新建、升级、拒绝、建组/复用组、升级不改组五路径
- [ ] 2.3 导入确认界面：逐行列出 新建/升级/拒绝（原因）+ 可勾选 + 清洗版与剥离内容对照 + scripts/、references/ 忽略明示；组件测试覆盖勾选部分导入与确认落库

## 3. 手动编辑版本化与回退

- [ ] 3.1 版本历史 UI：类别编辑区可展开版本列表（版本/来源/时间）+「回退到此版本」（复制旧版为最新，skill_meta 记 rollbackFrom）；「设置页保存即追加 manual_edit 版本」的 store 改造已由 review-versioning 落地（其任务 2.4），此处仅做回归断言（保存产生版本、`duplicateCategory`/恢复内置类别已版本化）；组件测试覆盖保存产生版本、回退后最新内容等于所选旧版、历史版本不被删除
- [ ] 3.2 版本历史 UI：类别编辑区可展开版本列表（版本/来源/时间）+「回退到此版本」（复制旧版为最新，skill_meta 记 rollbackFrom）；组件测试覆盖保存产生版本、回退后最新内容等于所选旧版、历史版本不被删除
- [ ] 3.3 影响范围验证：回退后查看既有已审轮次，其冻结提示词版本与结果不变（依赖 review-versioning 的 runs.category_version 断言）

## 4. 验收

- [ ] 4.1 端到端：导入真实 skills zip（含 scripts/ 与 references/）→ 确认导入 → 新类别按包名成组（设置页分节与 New Review 切换器可见）且可审阅、产出 findings 正常解析；再导入同名新版 → 版本历史 +1 且可回退、分组归属不变
- [ ] 4.2 全量验收：`npm test`、`npm run build`；安全用例集（zip-slip / 超限 / 缺 SKILL.md）全部给出明确拒绝或跳过说明
