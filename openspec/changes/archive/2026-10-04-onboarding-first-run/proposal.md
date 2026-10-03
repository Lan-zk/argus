# onboarding-first-run

## Why

首次运行时 `models` 为空，用户直到在「新建审阅」点「开始审阅」才在校验错误里撞到「没有可用模型配置，请到设置中添加」——关键前置条件（至少配置一个模型厂商）暴露得太晚。需要把"配一个模型"变成首次打开的第一屏主动引导，且可跳过、可随时手动重看（自助重看与测试都需要）。

## What Changes

- **首次运行判定（粘性标记）**：`settings.ui.onboarded`（默认 `false`）持久化于现有设置文件；未置位时首启自动进入引导，完成或跳过即置位，之后不再自动弹出。跳过是被尊重的"只问一次"；用户删光模型也不会被再次自动引导。
- **独立引导层，不设独立欢迎屏**：App 根级 `v-if` 挂载全屏引导层（不透明 `--paper` 背景盖住 nav，nav 保留在 DOM），不进入三页导航。选服务商步骤自带轻量 hero（品名 + 一句话价值 +「两步完成」），流程为：**选服务商 → 配置 → 完成**，步骤标号沿用 `01/02` 编号语言。
- **选服务商步骤**：预设服务大卡片（按 cn / global / aggregator 分组，为引导页重新设计，非设置页样式）；「自定义连接 / 本地模型」入口保留但视觉降级（细分割线下次级行）。
- **配置步骤**：预设只填 API Key + 模型下拉；自定义全字段。复用现有逻辑引擎（presets / model-discovery / keyring / 同 Provider Key 复用 / 错误分类），MUST NOT 复用 SettingsPage 的 UI 与样式。
- **测试连接不设门槛**：Key 失焦自动检索本身即连接验证；失败按既有契约弱提示降级（静态目录仍可选、保存不阻断），保留「重新检索」入口，不设独立测试连接步骤。
- **落点**：完成 → `addModel`（首条配置自动成为默认）+ 置位标记 + 跳「新建审阅」；跳过 → 置位标记 + 回到进入引导前的页面。
- **手动唤醒入口**：设置页 Models 区块内「重新运行引导」按钮（用户自助重看，亦方便测试）。
- **主题兼容**：全部使用 CSS 令牌书写、全屏不透明 `--paper` 背景、无半透明遮罩，4 个皮肤（swiss/apple × light/dark）零特判；mount 前主题已应用，引导首帧即正确皮肤。
- **细节**：Esc 不绑定跳过（避免误触丢失 Key 输入）；每步 autofocus 首个输入件。
- **测试兼容**：现有 `App.test.ts` 的三 tab 与页面文案断言需预置 `onboarded=true`（引导层不卸载 nav，DOM 断言不受影响；文案扫描需排除或先关闭引导层）。
- **可选加项**：「新建审阅」页在无可用模型时显示内联提示（「尚未配置模型 → 去设置 / 重新运行引导」），替代点开始审阅才报错的断点。

## Capabilities

### New Capabilities

- `onboarding`: 首次运行判定（粘性标记 `onboarded`）、引导流程契约（选服务商 → 配置 → 完成或跳过、测试连接不设门槛）、完成与跳过的落点、手动重看入口、引导层主题兼容约束。

### Modified Capabilities

（无。`app-persistence` 的「界面偏好记忆」为「至少包括工作台左右分栏宽度」的下界表述，`onboarded` 标记持久化于 `settings.ui` 属其自然延伸，无需修改该需求；`settings` 既有需求不受影响——「重新运行引导」按钮作为 `onboarding` 能力内的入口需求；`review-ui` 三页骨架不变，引导层是根级覆盖层而非第四页。）

## Impact

- 新增：`src/stores/onboarding.ts`（active 状态 + start/complete/skip 动作）、引导层组件（单个组件内部 step 联合类型，路径 design 定）。
- 修改：`src/lib/persistence.ts`（defaultSettings 增加 `ui.onboarded`）、`src/stores/settings.ts`（标记读写动作）、`src/App.vue`（挂载引导层 + 首启检查）、`src/pages/SettingsPage.vue`（重新运行引导按钮）、可选 `src/pages/NewReviewPage.vue`（无模型内联提示）。
- 复用不动：`domain/presets`、`ai/model-discovery`、`lib/keyring`、`ai/test-connection`、settings store 的模型 CRUD 与 Key 复用逻辑。
- 测试：onboarding store 单测、引导层交互测试（首启自动弹、跳过/完成持久化与落点、手动唤醒）、`App.test.ts` 预置调整。
