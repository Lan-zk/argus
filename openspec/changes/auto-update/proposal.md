## Why

发布已走 GitHub Release 多平台 CI，但用户感知新版本的唯一途径是主动去看仓库页面，更新 = 手动下载安装包覆盖安装，无差异提示、成本高。应用内需要一个「检测到版本差异 → 用户确认 → 自动完成更新」的闭环，把更新摩擦降到点击一次。

## What Changes

- 接入 Tauri v2 官方更新链路（`tauri-plugin-updater` + `tauri-plugin-process`）：以 GitHub Release 的 `latest.json` 为唯一更新源
- 版本检查双入口：应用启动后静默检查一次；设置页新增「关于 · 检查更新」区块支持手动触发
- 检查失败（网络错误 / 清单不存在 / 超时）MUST 静默降级，不打扰用户；手动触发时失败 SHALL 显示可读错误
- 更新提示：发现新版本时展示新版本号与更新说明（Release notes）；MUST NOT 未经用户确认自动下载或安装
- 一键更新：用户点击后下载（展示进度）→ minisign 验签 → 安装 → 重启；验签失败 MUST 拒绝安装并报错，不落地半成品
- 发布流程调整：CI 保持草稿发布（`releaseDraft: true`），维护者手动「发布」Release 后更新才对用户可见——**发布动作即更新开关**（已评审的决策，可复议）
- 平台覆盖：macOS（.app.tar.gz）/ Windows（NSIS 安装包）/ Linux（AppImage）；**明确排除**：MSI 安装的用户不在自动更新覆盖范围（latest.json 每平台单文件，选 NSIS）
- **明确排除**：不做增量/差量更新、不做多更新通道（beta/stable）、不做强制更新；不引入 Apple 公证 / Windows 代码签名（沿用 minisign 验签保障更新包完整性）

## Capabilities

### New Capabilities

- `app-updates`: 应用内自动更新全流程行为契约：版本检查时机与静默降级、更新提示与用户确认、下载进度与验签安装、重启行为、更新通道（已发布 Release 才生效）与平台覆盖范围

### Modified Capabilities

（无——设置页仅作为「检查更新」入口宿主，`settings` 既有 REQUIREMENTS 不变。）

## Impact

- **依赖**：Rust 侧 `tauri-plugin-updater`、`tauri-plugin-process`；前端 `@tauri-apps/plugin-updater`、`@tauri-apps/plugin-process`；capabilities 增补 `updater:default`、`process:allow-restart`
- **配置**：`tauri.conf.json` 增 `plugins.updater`（endpoint + 公钥）与 `bundle.createUpdaterArtifacts: true`；CSP 无需改动（更新请求从 Rust 侧发出，不受 WebView `connect-src` 约束）
- **CI**：`release.yml` 增签名环境变量（`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）与 `updaterJsonPreferNsis: true`；tauri-action 默认行为已包含生成上传 `latest.json` 与 `.sig` 签名文件，多平台 matrix 经同一 tag 汇总
- **密钥管理（一次性承诺）**：`tauri signer generate` 生成 minisign 密钥对——公钥入 `tauri.conf.json`（随仓库），私钥入 GitHub secrets 并 MUST 离线备份；私钥丢失即已装用户永久无法收到更新
- **代码**：新增更新状态模块（store/领域逻辑，落点 design 阶段定）；`SettingsPage` 增「关于」区块；UI 文案中文，遵循语义色铁律
- **风险**：macOS 应用未做 Apple 签名/公证，minisign 验签是唯一门槛——首个带更新器的版本发布后 MUST 实测一次「旧版 → 更新 → 重启」链路再视为达成
