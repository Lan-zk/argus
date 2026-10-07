# document-import — 任务清单

## 1. 文件接入

- [x] 1.1 添加 `tauri-plugin-dialog` / `tauri-plugin-fs`（Cargo + package + capabilities 最小权限）；txt/md 直读（BOM/换行归一）单测通过
- [x] 1.2 New Review 页「导入文件」入口（格式过滤 .txt/.md/.docx/.pdf）；选择 .doc 时给出「另存为 .docx」指引且不进入解析；组件测试覆盖入口与排除提示

## 2. docx 提取

- [x] 2.1 集成 `mammoth`（动态 import，**使用 `mammoth.browser` 入口 + d.ts shim**，默认 node 入口会使 vite 构建失败）：docx → HTML → Markdown 风格文本映射（标题/段落/列表/引用/代码/表格文本行）；单测覆盖含各元素的样例文档，断言正文文字无丢失
- [x] 2.2 提取产物过 `parseBlocks` 验证块类型识别（标题归 heading、引用归 quote 等）；单测断言块序列与行号契约满足

## 3. pdf 提取

- [x] 3.1 集成 `pdfjs-dist`（动态 import + worker 资产放置，`disableWorker` 兜底）；三平台构建加载验证（**必须覆盖 release CSP**：`default-src 'self'` 下同源静态 worker 可载、blob/内联 worker 会被拦截）
- [x] 3.2 文字层提取 + 行聚类 + 断行拼段 + 双栏尽力聚类；无文字层判定（字符数阈值）走排除提示；单测覆盖单栏/双栏/断行样例与扫描件判定

## 4. 预览确认与策略

- [x] 4.1 预览确认层：来源信息 + 可编辑文本区 + 取消/确认；确认后写入输入区等价粘贴；取消零落库；组件测试覆盖确认/取消/手动修正路径
- [x] 4.2 导入路径长文策略：超 30k 警告（说明降级与定位影响）+ 允许继续 + 不截断；**改造 NewReviewPage：30k computed 截断与「已达上限」计数提示收窄为仅粘贴/手动输入路径，导入写入绕过截断**（对应 review-ui delta）；粘贴路径行为回归不变；单测覆盖 80k 导入全量进入与粘贴超限仍被阻止
- [x] 4.3 来源元数据 `source_meta` 落库（kind/filename/importedAt），轮次信息展示来源；一致性提示数据位与文案接入对比面板（两轮 kind 不同时显示）

## 5. 验收

- [x] 5.1 端到端：docx 与 pdf 各导入一份真实文档 → 预览修正 → 审阅 → 锚定高亮正常；应用数据目录无原件副本
- [x] 5.2 全量验收：`npm test`、`npm run build`（核对动态分块、首屏体积不增）；mac/win/linux 三平台 pdf worker 加载验证
