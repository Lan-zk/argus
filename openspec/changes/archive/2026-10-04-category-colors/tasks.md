# category-colors — 任务清单

## 1. 颜色资产与校验

- [x] 1.1 `tokens.css` 四主题块各新增 `--p1..--p10` 调色板令牌（初值按 D2 色相空档取）；`scripts/contrast-check.mjs` 增加规则：每个 `--p*` 对 paper/card ≥3:1（HARD）；跑脚本迭代色值至全部达标
- [x] 1.2 抽取 WCAG 对比度纯函数到 `src/lib/contrast.ts`（hex 解析 / 亮度 / 比值，支持对任意底色计算），`contrast-check.mjs` 改为复用该实现；纯函数单测覆盖 hex/rgb/透明度合成分支

## 2. 选择弹层

- [x] 2.1 新建 `CategoryColorPicker.vue`：色板网格（10 令牌色，选中态高亮）+ 自定义 `<input type="color">` + 对比度提示区 + 当前色预览；Esc / 点击外部 / 再次点击入口关闭；组件测试覆盖打开、色板选择回写 `updateCategory`、自定义输入触发低对比提示（<3:1 显示 ⚠、可保存）
- [x] 2.2 弹层样式接入 `.pop` 毛玻璃与 `popin` 动效，csr 行容器补 `position:relative`；四组合下弹层无裁剪、无串色（截图目检）

## 3. 入口与兜底接线

- [x] 3.1 `SettingsPage.vue` csr-top 色块改为按钮触发弹层（含 aria-label「更改颜色」与 focus-visible 态）；验证色板选择后设置页色块、New Review 类别行即时变色
- [x] 3.2 `settings.ts` `addCategory` 兜底色改为 `--p[(自定义类别数) % 10]` 轮转；单测断言连续新建两个未指定颜色的类别获得不同令牌色

## 4. 整体验收

- [x] 4.1 端到端验证：新建类别（默认轮转色）→ 色板改色 → 切换明暗皮肤颜色跟随 → 自定义 hex 保存后不随皮肤变化且低对比时有提示；工作台高亮 / 卡片 / 报告颜色一致（浏览器实测四组合截图）
- [x] 4.2 全量验收：`npm test`、`npm run build`（含 vue-tsc）通过；`contrast-check.mjs` 全绿
