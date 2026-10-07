# settings-in-sidebar — 技术设计

## Context

原型三变体（`design/04-设置入侧栏原型.html`，prototype/UI 分支）经用户确认，裁决为 **B 的账户行 + A 的设置页**：侧栏底部是模型状态账户行（Codex 式），点击弹菜单；菜单内「设置」把主区整体切换为设置页。用户同时要求 Apple 皮肤加入 macOS 特有的磨砂质感。现状约束：`App.vue` 渲染 `<nav>` 顶栏（品牌/面包屑/设置 navtab）；`base.css` 的 nav/brand/navtab 样式族与 Apple 覆盖层的黑导航段仅服务该顶栏；`uiStore.page` 已是 `review | settings` 两态，设置页已按主区整页渲染，无需改路由模型。

## Goals / Non-Goals

**Goals:**

- Codex 式「侧栏 = chrome」：去顶栏后品牌、新建、项目、设置入口全部在第一栏，主区纯内容
- 瑞士皮肤的墨线身份不丢（6px 墨线转移到侧栏头部下边线）
- Apple 皮肤的 macOS 磨砂语法有据可依：浮层玻璃 + 系统菜单影 + 菜单 accent 选中 + 侧栏 accent 淡填充选中
- `uiStore` 页面模型不动，`App.test.ts` 等外壳测试随新 chrome 更新

**Non-Goals:**

- 不做侧栏 vibrancy 半透明（窗口下无内容可磨砂，假透明是装饰；磨砂只用于真浮层）
- 不做全局搜索 / ⌘G（Codex 有，Argus 数据面暂不需要，记为未来项）
- 不改 onboarding 层（独立全屏覆盖，与 chrome 无耦合）

## Decisions

- **D1 账户行内容 = 默认模型 + 就绪点**：`settings.defaultModel` 的显示名/模型名；无配置时显示「未配置模型」。菜单四项：设置 / 切换主题风格（swiss↔apple 即切）/ 重新运行引导 / 关于。菜单复用 `.pop` 浮层词汇（`.pop-h` + `.pop-item`），零新组件类。
- **D2 设置页返回路径双保险**：页头「← 返回审阅」（`ui.goReview('workspace')`）+ 点侧栏任意项目返回；`ui.page='settings'` 时账户行呈激活态。
- **D3 瑞士墨线转移**：`.psb-head` 下边线 swiss = 6px `var(--ink)`，apple = `var(--hair)`；顶栏删除后 `base.css` 的 nav/brand/navtab 族与 Apple 黑导航覆盖段一并移除（`.session-chip` 保留，消费方为设置页与引导层）。
- **D4 Apple 磨砂三件套（浮层语义，不动 chrome 零阴影原则的正文面）**：
  1. `.pop`（apple）加系统菜单影 `0 6px 18px rgba(0,0,0,.14), 0 1px 3px rgba(0,0,0,.08)`——macOS 菜单必有窗口影，登记为「浮层唯一影例外」；
  2. `.pop-item:hover`（apple）= accent 填充 + `--on-accent` 白字（macOS 菜单选中语法）；
  3. 撤销浮条（apple）= 磨砂玻璃胶囊卡：`--card` 72% + `saturate(180%) blur(20px)` + 发丝边 + 菜单影 + 14px 圆角，文字 ink。
- **D5 macOS 侧栏选中语法**：`.psb-row.on`（apple）= accent 10% 淡填充 + `.psb-name` accent 色；swiss 保持卡底 + inset 2px 墨条。
- **D6 折叠态**：侧栏折叠后主区左上角固定浮现「☰ 展开审阅列表」按钮（`App.vue` 统一渲染，不侵入各页面）。

## Risks / Trade-offs

- Apple 菜单 accent 填充 hover 会作用于工作台多 Finding 弹层：其内 `.sev` 徽章在蓝底上仍可辨（红底白字/描边件），接受；若实测噪杂可回退为 paper2 着色
- `design.md`（根，Apple 外部分析）的「零投影」与 D4 的浮层影例外冲突：以 DESIGN-GUIDE/DESIGN.md 的本地条目为准（浮层=窗口语义，非 chrome 装饰），并在两文档登记
