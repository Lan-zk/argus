# runstrip 单组件打磨 — 设计说明（2026-10-06，oil-ui 组件级五步）

- **用户任务**：六镜头并行审阅时随时一眼掌握各镜头状态；完成后获得"审阅收束"的确认感。
- **主动作**：每个镜头完成落定的瞬间（六次小落定 + 全部完成的大收束）。
- **选定方向**：**类别墨线**——视觉主角是类别色（每镜头一色），状态即墨线：
  - pending：无线，色块减淡至 45%（镜头未上场）
  - running：22% 淡轨道 + 30% 色段循环滑行（活字排版隐喻；transform 动画 1.4s ease-in-out，仅运行态循环）
  - completed：3px 墨线从左压满（scaleX stamp，250ms ease-out-quint）；六镜头全完成后连成一条六色墨线
  - failed：2px 红虚线断线（与 unanchored 卡同 dashed 方言）+ 重跑按钮 + 错误单行省略（title 全文）
- **关键状态**：见上；另有六格错峰 35ms 出场（cardin 语法）、`prefers-reduced-motion` 全局兜底。
- **设备约束**：桌面 ≥1240 宽；两皮肤同形（数据记号不随皮肤变形）；Token Rule（类别色经 colorMap 运行时传入，无字面量）。
- **验收重点**：状态一眼可读（不读文字也能分清四态）；六色连线是否成为记忆点；失败态诚实且可行动；密度与布局不变。
- **实现落点**：`WorkspacePage.vue`（runcell 状态类 + rc-ink 元素 + rc-err 省略）、`base.css`（.runcell/.rc-ink 样式与两条 keyframes）、`design/DESIGN-GUIDE.md` §4 词汇表。
- **证据**：`shots-runstrip/`（完成态 ×4 皮肤、200%、失败态、级联四帧）。
