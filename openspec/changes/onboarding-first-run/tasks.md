# onboarding-first-run — Tasks

## 1. 数据层与状态

- [x] 1.1 `src/lib/persistence.ts`：`defaultSettings()` 的 `ui` 增加 `onboarded: false`；`loadState()` 增加升级迁移——数据缺该标记且 `models` 非空时视为已完成。补 `persistence.test.ts` 用例：全新数据默认 false、老数据（有模型无标记）迁移为 true、已有标记以存值为准
- [x] 1.2 `src/stores/settings.ts`：新增 `setOnboarded(v: boolean)` 动作（置位并持久化）。补 `settings.test.ts` 用例验证置位后 `persist` 数据含该字段
- [x] 1.3 新建 `src/stores/onboarding.ts`（`active` / `returnPage` / `start()` / `complete()` / `skip()` / `maybeAutoStart()`，语义见 design D3）。新建 `onboarding` store 单测：start 幂等并记录 returnPage、complete 置位并落「新建审阅」、skip 置位并回原页、maybeAutoStart 三条件判定

## 2. 引导层组件

- [x] 2.1 新建 `src/components/OnboardingLayer.vue` 骨架与 pick 步骤：step 联合类型状态机（design D4）、轻量 hero（`models.length > 0` 时文案适配「再配一个，或跳过」）、预设分组大卡片（cn / global / aggregator）、细分割线下「自定义连接 / 本地模型」次级入口、`01/02` 步骤标号。组件测试：pick 渲染分组卡片、点击预设进入 preset configure、点击本地进入 custom configure
- [x] 2.2 预设 configure 步骤：唯一必填 API Key + 模型下拉，复用 `ai/model-discovery`（静态目录先行、Key 失焦 300ms 防抖自动检索、`reusableKey` 复用、检索失败弱提示不阻断、↻ 重新检索）。组件测试：模拟检索合并模型列表、无 Key 禁用保存、检索失败仍可保存
- [x] 2.3 自定义 / 本地 configure 步骤（全字段，本地预填 `http://localhost:11434/v1`）；保存统一走 `settings.addModel` 后调 `complete()`。组件测试：保存后 `settings.models` 新增且首条自动默认、引导关闭并落「新建审阅」
- [x] 2.4 视觉与交互细节：全屏不透明 `var(--paper)` 覆盖、全部样式经主题令牌（无硬编码色值，组件测试静态断言 style 段无 `#hex`/`rgb(`）、每步 autofocus 首个输入件、Esc 不绑定跳过（组件测试触发 Esc 后 `active` 仍为 true）

## 3. 集成

- [x] 3.1 `src/App.vue`：根部 `v-if` 挂载引导层（nav 与三页保留 DOM）；双检接入——`setup()` 同步调用 `maybeAutoStart()`（主路径首帧判定零闪烁）+ `onMounted` 的 `init()` 之后再调一次（测试路径兜底）。App 级测试：`onboarded` 未置位时首帧出现引导层、置位时不出现
- [x] 3.2 `src/pages/SettingsPage.vue`：3.1 Models 区块尾部加「重新运行引导」`mini` 按钮 → `onboarding.start()`。测试：点击后引导层显示，重看中跳过返回设置页且标记保持 true
- [x] 3.3 `src/pages/NewReviewPage.vue`：无可用模型时显示内联提示（「前往设置」/「重新运行引导」两去向）。测试：跳过引导后提示可见、配置模型后消失

## 4. 测试与收尾

- [x] 4.1 迁移 `src/App.test.ts`：两个既有用例 mount 前预置 `onboarded = true`；确认三 tab 与文案扫描断言不受引导层影响
- [x] 4.2 全量验证：`npx vitest run` 全绿；`openspec validate onboarding-first-run --strict` 通过；手动核验 4 皮肤组合下引导层渲染（含 980×640 最小窗口）与引导中切换主题即时跟随
