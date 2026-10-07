## Why

当前输入只支持粘贴文本，Word / PDF 用户的「在 App 外修改 → 传回再审」循环断裂（复制粘贴丢结构、易错）；且 docx/pdf 提取必然有损耗（表格松散、图片丢失、断行错乱），若静默进入审阅，用户审的是一份失真的文本。需要文件导入 + 预览确认，使多轮循环对 Word/PDF 用户真正可用。

## What Changes

- 新增文件导入入口（New Review 页）：支持 txt / md / docx / pdf 四种格式
- **明确排除**：扫描件 PDF（无文字层，检测后给出不支持说明，不引入 OCR）与旧版 .doc（提示另存为 .docx）
- 提取在前端完成（docx → 段落结构；pdf → 文字层提取 + 断行拼回归一化），产出统一纯文本汇入现有解析管线（块模型与行号契约不变）
- **预览确认步**：导入解析后先展示「将进入审阅的最终文本」，用户确认或手动修正后才进入审阅流程；取消不产生任何数据
- 导入路径长度策略：超过 30 000 字符时警告并允许继续（将触发长文结构化降级），MUST NOT 静默截断；粘贴路径上限行为不变
- 来源元数据：记录格式、文件名、导入时间（挂接轮次文档，服务溯源）；MUST NOT 保存原文件，界面注明审阅基于提取文本
- 管道一致性提示：同一项目相邻两轮输入方式不同（粘贴 vs 导入）时，提示跨轮对比噪声可能变大

## Capabilities

### New Capabilities

- `document-import`: 文件导入全流程行为契约：支持格式与排除项、提取与归一化、预览确认、长文策略、来源元数据与一致性提示

### Modified Capabilities

- `review-ui`: 「原文输入与长度上限」的 30 000 字符硬上限显式收窄到粘贴/手动输入路径；导入路径的超限行为由 `document-import` 的「导入长文策略」规定（警告后允许继续），消除两条 MUST 的互斥

## Impact

- **依赖**：新增 `tauri-plugin-dialog`、`tauri-plugin-fs`（只读用途）、`mammoth`（docx）、`pdfjs-dist`（pdf，动态 import）；Tauri capabilities 增补 dialog 与受限 fs 权限
- **代码**：`src/pages/NewReviewPage.vue` 增导入入口与预览确认界面；新增 `src/lib/importers/`（按格式拆分提取器）；提取产物进入既有 `parseBlocks` 管线，`document-parsing` 与锚定算法零改动
- **数据**：来源元数据写入轮次文档的 `source_meta`（依赖 `review-versioning` 里程碑 0 的 schema；建议在其后实施）
- **体积**：mammoth / pdfjs-dist 动态 import，仅导入时加载
