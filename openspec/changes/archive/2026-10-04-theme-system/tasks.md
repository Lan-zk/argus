# theme-system — 任务清单

## 1. 令牌与样式地基（视觉零变化重构）

- [x] 1.1 清点 `base.css` 全部 `--red` 用法，逐条归类为 accent（品牌强调）或 danger（错误/高危），产出归类清单；用 `grep -c` 核对清点数与清单条数一致，确认零遗漏
- [x] 1.2 重构 `tokens.css`：引入 `--accent --danger --on-accent --on-danger --shadow-pop` 与形状令牌（`--radius --radius-sm` 等），`:root` 保持 swiss-light 现值；验证 `npm run build` 通过且界面目检与现状逐像素一致
- [x] 1.3 `base.css` 按 1.1 清单分流 `--red` 用法，`#fff`（selection/sev.high/restore-banner/toast）与 `.pop` 的 `rgba` 阴影替换为新令牌；验证 `npm run dev` 下三页目检与现状一致

## 2. 解析与应用机制

- [x] 2.1 新建 `src/lib/theme.ts`：纯函数 `resolveTheme(theme, appearance, systemDark)` 返回四组合之一；vitest 单测覆盖 swiss/apple × light/dark/system 的全部分支
- [x] 2.2 主题应用逻辑（theme store 或等价 composable）：`watchEffect` 将解析结果写入 `documentElement.dataset.theme` 并同步 CSS `color-scheme`；`matchMedia('(prefers-color-scheme: dark)')` change 监听更新 `systemDark`；单测验证 system 模式下监听触发后属性切换
- [x] 2.3 `settings.ui` 增加 `theme`（默认 `swiss`）与 `appearance`（默认 `system`）字段，`loadState` 对旧数据做默认值合并；`settings.test.ts` 与 `persistence.test.ts` 补用例并通过（含旧数据无新字段场景）
- [x] 2.4 `main.ts` 初始化前移：`createApp` 前 `await loadState()` 并应用主题后再 `mount`，`App.vue` 的 `onMounted` 改为消费已加载状态（session 恢复等逻辑不变）；`npm test` 全量通过并手工验证重启恢复提示条行为不变

## 3. 皮肤交付

- [x] 3.1 `tokens.css` 增加 `[data-theme="swiss-dark"]` 颜色块：纸/墨反转（深灰阶非纯黑）、7 类别色与严重度色重调、`--on-accent/--shadow` 暗色取值；工作台目检类别色块与高亮可辨识
- [x] 3.2 增加 `[data-theme="apple-light"]`：颜色块（accent=系统蓝、danger=红系）+ 形状令牌覆盖 + `base.css` 中 `[data-theme^="apple"]` 控件形态覆写（圆角按钮/输入框/徽章/卡片/弹层/分段式 tab/SF 字体栈/蓝色焦点环）；设置页与工作台目检无瑞士直角残留
- [x] 3.3 增加 `[data-theme="apple-dark"]`：Apple 暗色调色板 + 复用 apple 形状层；目检同 3.2
- [x] 3.4 编写一次性对比度校验脚本（对四组合令牌组合计算 WCAG 比值：正文 ≥4.5:1、类别/严重度图形色 ≥3:1），输出报告并据此微调色值至全部达标

## 4. 设置页与整体验收

- [x] 4.1 `SettingsPage.vue` 新增「外观」分区：主题选择（瑞士风格 / Apple 风格）与明暗选择（亮色 / 暗色 / 跟随系统），变更即写入 `settings.ui` 并即时生效；组件测试验证切换后 `data-theme` 属性变化且持久化字段更新
- [x] 4.2 四组合皮肤逐界面目检：导航、新建审阅、工作台（原文高亮/卡片/弹层）、报告、设置、Toast，确认无串色、无透明不可读、无残留元素（对应 spec 场景「任意组合下无未定义样式」）
- [x] 4.3 手工验证：偏好设为 Apple+暗色后重启恢复两个选择器状态；暗色偏好冷启动首帧即为暗色无闪烁；跟随系统模式下切换系统明暗应用实时跟随
- [x] 4.4 全量验收：`npm test`、`npm run build`（含 vue-tsc）通过；默认偏好（swiss+system+亮色系统）下与主分支视觉一致
