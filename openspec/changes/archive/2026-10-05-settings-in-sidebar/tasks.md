# settings-in-sidebar — 任务清单

## 1. 外壳重构

- [x] 1.1 `App.vue` 移除 `<nav>` 顶栏（品牌/面包屑/设置 navtab）及 `shell-toggle/crumb/nav-right` scoped 样式；侧栏改为 `review` 与 `settings` 两页均渲染；新增折叠态主区左上角展开按钮；撤销浮条包 `Transition`（沿用）
- [x] 1.2 `ProjectsSidebar.vue`：头部改品牌区（图标 + ARGUS + microlabel + 折叠「«」，swiss 下边线 6px 墨线 / apple 发丝线）；底部新增账户行（默认模型 + 就绪点 + ▲），点击弹 `.pop` 菜单（设置 / 切换主题风格 / 重新运行引导 + 版本/隐私脚注行），点外与 ESC 关闭；`ui.page==='settings'` 时账户行激活态
- [x] 1.3 `SettingsPage.vue` 页头补「← 返回审阅」+ 标题「设置」+ 提示（入口位于左栏底部）；`WorkspacePage` 轮次条左端补当前项目名（侧栏折叠时主区仍有上下文）
- [x] 1.4 `base.css` 清理死样式：nav/brand/navtabs/navtab/nav-right 族、`tabin` 键帧、transition 列表中的 `.navtab`、Apple 黑导航覆盖段与 `.session-chip` 的黑底覆盖（`.session-chip` 本体保留）

## 2. Apple 磨砂打磨

- [x] 2.1 `.pop`（apple）补系统菜单影（浮层唯一影例外）；`.pop-item:hover`（apple）改 accent 填充 + `--on-accent`
- [x] 2.2 撤销浮条（apple）改磨砂玻璃胶囊卡（`--card` 72% + blur/saturate + 发丝边 + 菜单影 + 14px 圆角，文字 ink，按钮随 Apple 默认语法）
- [x] 2.3 `.psb-row.on`（apple）改 accent 10% 淡填充 + 标题 accent 色；swiss 保持 inset 墨条

## 3. 测试与文档

- [x] 3.1 `App.test.ts` 适配新 chrome：设置经账户行菜单进入/返回、onboarding 用例的 navtab 断言替换为侧栏断言
- [x] 3.2 回归：`npm test` 全量、`npx vue-tsc --noEmit`、`node scripts/contrast-check.mjs` 全绿
- [x] 3.3 文档同步：`design/DESIGN-GUIDE.md` §5 补 macOS 磨砂词汇与浮层影例外；根 `DESIGN.md` Components/Navigation 改侧栏 chrome、Elevation 登记浮层影；`design/04` 头注与 `design/README.md` 回填原型裁决（B 账户行 + A 设置页）
