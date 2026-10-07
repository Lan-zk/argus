# document-import — 技术设计

## Context

见 proposal「Why」。现状约束：无 fs/dialog 插件与对应 capability，输入仅粘贴（30k 上限、超限阻止）；解析契约是「纯文本 → `parseBlocks` → 块 + 行号」，提示词以 `L{n}|` 逐行前缀，锚定靠 quote→block 匹配——导入产物必须满足该契约；长文降级机制已存在（按模型上下文触发）。本 change 依赖 `review-versioning` 里程碑 0 的 `documents.source_meta` 列；若先行开发提取器，可先以纯函数模块形态独立合入。

## Goals / Non-Goals

**Goals:**

- 四种格式产出同一条管线的纯文本；块模型、行号、锚定算法零改动
- 预览确认拦截提取损耗，用户可在进入审阅前修正
- 明确排除项给可行动指引，不做静默降级
- mammoth / pdfjs 动态加载，不增加首屏体积

**Non-Goals:**

- 不做 OCR、不解析旧 .doc（spec 已定边界）
- 不保存原文件、不做「从原文重新提取」
- 不做 pdf 版面/表格结构还原（只做文字层与断行归一）
- 不改粘贴路径的 30k 上限行为

## Decisions

### D1：提取全部在前端 webview，动态 import

- 备选：Rust 侧 crate（docx-rs / pdf-extract）—— 否决：Rust pdf 提取 crate 成熟度参差，且与「肥 TS 前端」架构相悖，keyring 之外不新增 Rust 领域逻辑
- **选定**：`mammoth`（docx→HTML/纯文本，浏览器构建成熟）+ `pdfjs-dist`（`getTextContent` 提取文字层）；两者均动态 `import()`，只在用户触发导入时加载
- pdfjs worker 集成：将 worker 构建产物放 `public/` 并设 `GlobalWorkerOptions.workerSrc`；Tauri webview 下经 asset 协议加载；若个别平台 worker 受阻，回退 `disableWorker`（性能下降但可用）作为兜底路径。CSP 注意：tauri.conf.json 为 `default-src 'self'`，同源静态 worker 可加载，但 blob:/内联形态的 worker 会被拦截——三平台验证必须覆盖 release CSP（非仅 devCsp）
- mammoth 入口注意：其默认入口依赖 node 内置模块、vite 构建会失败——必须改用包内 `mammoth.browser` 构建（UMD、无官方类型声明，需配套 d.ts shim）
- 纯浏览器 dev 模式兜底：dialog/fs 插件在浏览器全不可用，dev 模式（`isTauri()` 为 false）导入入口降级为 HTML `<input type="file">`（同时免去两个插件与 capability 授权），与 persistence.ts 既有分流惯例一致

### D2：文件接入 — dialog + 受限 fs

- `tauri-plugin-dialog`（open 对话框）+ `tauri-plugin-fs`（`readTextFile` / `readFile`）；capability 仅授予用户选择的路径（`fs: allow-read-text-file` 等最小集合），不开放目录级读写
- txt/md 走 `readTextFile`（UTF-8，检测 BOM）；docx/pdf 走 `readFile` 二进制交前端库

### D3：各格式归一化规则

- **txt/md**：仅做换行归一（CRLF→LF），其余交给既有管线
- **docx**：mammoth 输出 HTML → 按块级元素（h1-h6/p/ul|ol>li/blockquote/pre）映射为「Markdown 风格文本」（标题 `#`、引用 `>`、代码围栏），使 `parseBlocks` 能识别类型；表格按行输出「单元格1 | 单元格2 …」文本行（spec：内容不丢，结构降级为文本）
- **pdf**：`getTextContent` 按 page 收集 items → 依 x/y 坐标聚类为行 → 断行拼段规则：行尾无句读且下一行起始 x 与段落体一致 → 拼接；双栏文档按 x 中线分栏聚类（尽力而为，错误由预览步兜底）
- 无文字层判定：全部 page 提取字符数 < 阈值（如 32）→ 判为扫描件，走排除提示

### D4：预览确认步交互

- New Review 页加「导入文件」入口 → 解析 → 弹出预览层：左上来源信息（文件名/格式/字数）、中间可编辑文本区（默认展示提取结果）、底部「取消 / 确认进入」
- 确认后：提取文本写入输入区（等价粘贴），沿用既有校验；**超 30k 时此处显示警告 + 「继续」确认（spec 长文策略），不再阻止**——现有 NewReviewPage 的 30k computed 截断与「已达上限」计数提示按 review-ui delta 收窄为仅粘贴/手动输入路径生效，导入写入绕过截断（任务化改造）
- 取消：丢弃解析产物，无任何落库

### D5：来源元数据与依赖衔接

- `ImportSource = { kind: 'txt'|'md'|'docx'|'pdf', filename, importedAt }` 写入 `documents.source_meta`（JSON 列）；粘贴轮次 `kind:'paste'`
- 一致性提示：对比面板读取相邻两轮 `source_meta.kind`，不同即显示提示（实现挂 review-versioning 的对比 UI，本 change 提供 数据与文案）
- 依赖顺序：schema 字段随 review-versioning 里程碑 0 建立；本 change 的 UI/提取器可并行开发，合入顺序在其后

## Risks / Trade-offs

- [pdfjs worker 在 Tauri webview 的兼容坑] → 备好 `disableWorker` 兜底；三平台（mac/win/linux）构建验证列入验收
- [pdf 双栏/表格提取错序] → 尽力聚类 + 预览步用户修正兜底；spec 已声明不做版面还原
- [bundle 体积] → 动态 import 隔离，首屏不变；验收时核对构建产物分块
- [docx 复杂样式（脚注/图片）信息丢失] → 预览可见、spec 界定内容不丢指正文文字；导入说明列出已知损耗

## Migration Plan

无存储迁移（新能力，`source_meta` 列由 review-versioning 建立）。合入顺序：review-versioning 里程碑 0 → 本 change。

## Open Questions

- 断行拼段与双栏聚类的具体阈值（行距容差、栏中线判定）—— 实现期用真实样本调，接口不变
