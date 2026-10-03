# onboarding-first-run — Design

## Context

见 proposal.md「Why」。约束现状：

- 无路由，页面切换是 `uiStore.page` 三值 + `v-show`；App.test.ts 直挂 App 断言 3 个 navtab 存在与页面文案。
- `main.ts` 在 mount 前 `await settings.init()` 并启动主题（首帧即目标皮肤）；App.vue `onMounted` 里 init 仅作测试路径兜底。
- 模型配置的完整逻辑引擎已存在且与 UI 解耦：`domain/presets`、`ai/model-discovery`（静态目录 + 在线检索 + 失败降级）、`lib/keyring`、settings store 的 `addModel`（首条自动默认、Key 进钥匙串、同 Provider 复用）。
- 主题为 `<html data-theme>` 上的 4 个平铺令牌块；形状令牌（`--radius`/`--shadow`）仅随主题轴变化——质感差异由令牌自动携带。
- `loadState()` 对 `ui` 做默认值合并（`{ ...default.ui, ...raw.ui }`），新增字段天然向后兼容。

## Goals / Non-Goals

**Goals:**

- 首启首帧即引导层，无主界面闪烁；完成/跳过持久化，重启不再弹。
- 引导交互独立设计，与 SettingsPage 零 UI 复用；逻辑引擎全部复用。
- 老用户（已有模型、无标记字段）升级后不被打扰。

**Non-Goals:**

- 不做主题选择步骤（引导兼容全部皮肤，但不负责选皮肤）。
- 不做多步欢迎向导 / 产品教学（hero 即欢迎，流程只有两步）。
- 不改 SettingsPage 既有模型配置流程的行为契约。
- `onboarded` 不做版本化 re-show（未来「新功能引导」另行立项）。

## Decisions

### D1. 粘性标记的形状、位置与升级迁移

`settings.ui.onboarded: boolean`，`defaultSettings()` 中默认 `false`。

**升级迁移（关键）**：`loadState()` 中，当持久化数据缺少该字段但 `models` 非空时，SHALL 视为已初始化（`onboarded: true`）。否则所有已配好模型的老用户升级后会被突然引导——违背"只问一次"。

- 为什么不用「存过 settings 即算完成」：`draftText` 持久化就会写 settings，存在"存过草稿但从未配模型"的用户，会被漏判为已完成。以 `models.length > 0` 为迁移依据才与"引导的目标是配一个模型"语义对齐。
- 为什么不是派生 `models.length === 0`（方案 A）：跳过不被尊重，删光模型会被再弹（探索期已否）。
- 为什么不用 `completedAt` 时间戳：当前没有消费方，YAGNI；未来 re-show 需求出现时再演进。

### D2. 挂载形态：App 根级覆盖层，不进导航

`App.vue` 根部 `<OnboardingLayer v-if="onboarding.active" />`，组件内部 `position: fixed; inset: 0`，不透明 `var(--paper)` 背景、最高 z-index。

- nav 与三页保留在 DOM（App.test 的 navtab 断言不受影响），指针事件被层自然截获，主界面不可达。
- 备选「uiStore 第四个 page」被否：污染 `PageId` 语义（引导不是用户可自由切换的页），且手动唤醒需要劫持当前 page 状态。
- 无半透明遮罩 / backdrop-blur：半透明与模糊在 4 个皮肤上的表现差异大；全屏不透明 `--paper` 使引导在任何皮肤下就是"应用本体的全屏页"，也天然规避 nav 在层下隐约可见的杂讯。

### D3. 状态机与首帧判定（消除闪烁）

新 `stores/onboarding.ts`：

```
state:  { active: boolean, returnPage: PageId }
start(): 记录 returnPage = ui.page，active = true（幂等）
complete(): settings.setOnboarded(true) → active = false → ui.go('new')
skip():    settings.setOnboarded(true) → active = false → ui.go(returnPage)
```

首启检查**双检**，封装为 `maybeAutoStart(): settings.loaded && !settings.ui.onboarded && !active`：

- App `setup()` 同步段调用一次——主路径（main.ts 已在 mount 前 init）此时 `loaded === true`，判定发生在首帧渲染前，层与首帧同现，**零主界面闪烁**（与 theme-system 的首帧论证同构）。
- App `onMounted`（`await settings.init()` 之后）再调用一次——测试直挂 App 的路径 `loaded` 初始为 false，由此兜底；与 `restore(lastReview)` 的时序模式一致。

`complete()` 由引导组件在 `settings.addModel()` 成功后调用；置位在 `addModel` 之后（addModel 内部已各自落盘），间隙崩溃的窗口极小，且重弹时用户可再跳过，可接受。

### D4. 组件：单组件内部 step 联合类型

`src/components/OnboardingLayer.vue` 单文件，内部 step 状态沿用 SettingsPage `AddFlow` 的联合类型模式：

```
type Step = { kind: 'pick' } | { kind: 'preset'; preset: ModelPreset } | { kind: 'custom'; local: boolean }
```

- pick 步骤：轻量 hero（品名 + 一句话价值 +「两步完成」）+ 预设分组大卡片（cn / global / aggregator，卡片为引导页重新设计：更大、更聚焦）+ 细分割线下视觉降级的「自定义连接 / 本地模型」次级行。步骤标号 `01 选择服务 / 02 粘贴 Key` 沿用 nav 的编号语言。
- configure 步骤：预设 = 唯一必填 Key + 模型下拉（Key 失焦 300ms 防抖自动检索、同 Provider 复用 Key、检索失败弱提示不阻断、静态目录兜底）；自定义 = 全字段（Base URL 预填本地端点）。交互逻辑从 `ai/model-discovery` 等模块导入，**不**从 SettingsPage 抽取或复制其模板与样式。
- Esc 不绑定跳过（避免误触丢 Key 输入）；每步 autofocus 首个输入件。
- 保存统一走 `settings.addModel`：钥匙串写入、首条自动默认、`displayName` 留空回退，全部免费获得。

### D5. 测试连接不设门槛

Key 失焦自动检索本身即真实连接验证（拉回在线模型列表 = Key 有效）；失败按 `ai-runtime` 既有契约弱提示降级（静态目录仍可选、保存不阻断）。保留「↻ 重新检索」按钮（检索交互的一部分），不设独立测试连接步骤。与 SettingsPage 行为对齐，不引入第二套验证语义。

### D6. 主题兼容策略

全部颜色 / 圆角 / 阴影经令牌引用（`--paper` `--ink` `--card` `--hair` `--accent` `--radius` `--shadow` 等），组件样式段零硬编码色值。质感差异由形状令牌自动携带：apple 皮肤下卡片自动获得圆角与柔和阴影，swiss 下自动方正。mount 前主题已应用（theme-system），引导首帧即正确皮肤，无需任何等待或特判。

### D7. 唤醒入口与重看语义

SettingsPage 3.1 Models 区块尾部加 `mini` 按钮「重新运行引导」（与 3.2 区块尾部「恢复内置类别」按钮的位置模式一致）→ `onboarding.start()`。重看时标记已为 true，跳过 / 完成不改变其值，仅按落点规则返回。重看场景下 pick 步骤的 hero 文案适配「再配一个，或跳过」（`models.length > 0` 时）。

## Risks / Trade-offs

- [首帧闪烁：层在主界面之后才出现] → D3 双检：setup 同步判定 + onMounted 兜底；主路径零闪烁，测试路径闪烁不可感知（内存 store 毫秒级）。
- [App.test 文案扫描被引导层误伤（`document.body.textContent` 含引导文案）] → 现有两个用例在 mount 前预置 `onboarded = true`（经 store 直设 + persist）；引导层自身文案也不含 MVP/PRD/§。属于 tasks 的显式迁移项。
- [`addModel` 成功但置位前崩溃 → 重启重弹但模型已在] → 接受（窗口极小）；重看文案适配（D7）使其不困惑。
- [980×640 最小窗口下卡片网格溢出] → 网格 `auto-fill + minmax` 自适应，hero 竖排紧凑；tasks 含最小尺寸人工核验。
- [未来新增"必看引导"需求] → `onboarded` 是单布尔，不支持按版本重弹；届时演进为版本化标记，不在本变更范围。

## Migration Plan

纯前端增量，无部署步骤。数据兼容由 `loadState` 默认合并 + D1 迁移规则保证；回滚 = 移除层与入口，遗留的 `onboarded` 字段无消费方、无害。
