## 1. 密钥与 CI 基建(先于代码合入)

- [x] 1.1 `npm run tauri signer generate` 生成 minisign 密钥对(设密码),私钥与密码完成离线双备份(密码管理器 + 本地密钥文件),公钥记录备用
- [x] 1.2 GitHub 仓库配置 secrets `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`,在 Actions 页面确认两条 secret 存在
- [x] 1.3 `release.yml` tauri-action step 增两个签名 env 与 `updaterJsonPreferNsis: true`,并保持 `releaseDraft: true` 不变;YAML 语法检查通过(`node -e` 或 CI lint)

## 2. Tauri 侧接入

- [x] 2.1 `src-tauri/Cargo.toml` 增 `tauri-plugin-updater`、`tauri-plugin-process`;`src-tauri/src/lib.rs` 注册两插件;`cargo check` 通过
- [x] 2.2 `tauri.conf.json` 增 `plugins.updater`(endpoint `https://github.com/Lan-zk/argus/releases/latest/download/latest.json` + 公钥)与 `bundle.createUpdaterArtifacts: true`,Windows `installMode: passive`;`npm run tauri build`(或 dev)确认配置被接受
- [x] 2.3 `capabilities/default.json` 增 `updater:default` 与 `process:allow-restart`;构建后 schema 校验无报错

## 3. 更新状态 store

- [x] 3.1 `package.json` 增 `@tauri-apps/plugin-updater`、`@tauri-apps/plugin-process`;`npm install` 成功
- [x] 3.2 新建 `src/stores/update.ts`:状态机(idle/checking/available/up-to-date/check-failed/downloading/installing/install-failed/unsupported)+ 静默/手动检查 + 进度聚合(0–100)+ 确认后 downloadAndInstall→relaunch;非 Tauri 环境初始化为 `unsupported`、静默路径吞错、手动路径产出可读中文错误;`update.test.ts` 用 vitest mock 插件模块覆盖状态机各流转与静默/手动错误分叉,全部通过
- [x] 3.3 `App.vue` `onMounted` 延迟静默检查接线(不进 `main.ts` 启动链);`npm run dev` 浏览器下无报错无横幅(unsupported 兜底生效)

## 4. UI

- [x] 4.1 新建 `src/components/UpdateBanner.vue`:非模态横幅(新版本号 + 更新说明摘要 + 「立即更新」/关闭),关闭后本次运行不再弹出;颜色走 `var(--accent)` 等令牌;挂 `WorkspacePage` 顶部;组件测试覆盖展示/关闭/触发更新三行为
- [x] 4.2 `SettingsPage` 增「关于 · 检查更新」区块:当前版本号、手动检查按钮、已是最新/失败可读错误/下载进度各态;unsupported 态仅显示版本号;`SettingsPage.test.ts` 增对应用例通过
- [ ] 4.3 按 `design/DESIGN-GUIDE.md` 走查两处 UI 双主题四组合,必要时 `$impeccable live` 调整;`node scripts/contrast-check.mjs` 通过
- [x] 4.4 同步 `src/stores/README.md`、`src/components/README.md` 目录说明

## 5. 全量验证与发布实测

- [x] 5.1 `npm test` 全量 + `cargo test` 通过;`npm run build` 类型检查通过
- [x] 5.2 合入后打 v0.2.0 tag:CI 四平台产物含 updater 产物(`.app.tar.gz`/`.sig`、NSIS exe + sig、AppImage + sig、`latest.json`),人工核对 latest.json 的 platforms 键、版本号与 notes 透传
- [ ] 5.3 手动发布 Release 后,用「版本号调低的本地构建」当旧版,实测 macOS「旧版 → 提示 → 更新 → 重启新版」链路(Gatekeeper 重点观察);有条件再抽验 Windows/Linux
- [x] 5.4 README(含 README-zh)发布流程补一句:发布 Release 的「Publish」动作即更新对用户可见的开关
