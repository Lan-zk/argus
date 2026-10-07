## Context

Tauri v2 应用,发布链路已就绪:`v*` tag → release.yml 四平台 matrix → tauri-action 上传 GitHub Release(`releaseDraft: true` 草稿)。目前无任何更新器依赖,前端已有经 Tauri 插件(Rust 侧)访问外网的先例(`tauri-plugin-http`),CSP 的 `connect-src` 不约束 Rust 侧请求。启动序列(`main.ts`:Tauri fetch 通道 → Pinia → `settings.init()` → `theme.start()` → mount)不可拖慢首帧。纯浏览器 `npm run dev` 是常用调试路径,桌面插件在该环境下不可用,必须有兜底。行为契约见 `specs/app-updates/spec.md`,此处只记实现决策。

## Goals / Non-Goals

**Goals:**

- 官方更新链路最小接入:复用 `tauri-plugin-updater` / `tauri-plugin-process`,自研只做 UI 与状态编排
- 发布流程零额外基建:GitHub Release 即更新源,不引入独立更新服务器或第三方服务
- 失败安全:任何检查/下载/安装失败都不影响当前版本可用

**Non-Goals:**

- 增量/差量更新、多更新通道(beta/stable)、强制更新
- Apple 公证 / Windows 代码签名(沿用 minisign 验签,系统级签名提示是既有安装包问题)
- 更新状态持久化(提示的「本次运行不再弹出」是内存态,随进程重置,无迁移负担)

## Decisions

### D1: 官方 updater 插件 + GitHub Release 静态清单,不自研

`tauri-plugin-updater`(check / downloadAndInstall / 进度事件)+ `tauri-plugin-process`(relaunch)覆盖全部目标行为,版本比较(semver)与 minisign 验签由插件内核承担,前端不重复实现。备选「GitHub API 检查 + 引导手动下载」被否:不满足「点击后自动更新」;自写更新器(下载替换 + 重启)在各平台的安装语义(NSIS 静默安装、AppImage 替换、.app 解包)上成本远超收益。

- endpoint:`https://github.com/Lan-zk/argus/releases/latest/download/latest.json`(匿名静态下载,无 API 限流;`releases/latest` 天然不指向草稿,即 spec 的「发布即开关」)
- `tauri.conf.json`:`plugins.updater { endpoints, pubkey }` + `bundle.createUpdaterArtifacts: true`
- Windows `installMode: passive`(默认推荐,带进度条不弹交互)

### D2: 独立 `src/stores/update.ts` 状态机,消费方两处

```
 idle ──> checking ──> available ──> downloading ──> installing ──> relaunch
              │           │                              │
              v           v                              v
        up-to-date   check-failed                  install-failed
        (手动路径可见)  (静默路径吞掉)              (当前版本保持可用)

 unsupported:非 Tauri 环境初始化即置此态,更新功能整体隐藏
```

- store 封装插件调用与状态流转;进度事件(Started/Progress/Finished)聚合为 0–100 数值
- 消费方:① `SettingsPage` 新增「关于 · 检查更新」区块(当前版本号、手动检查、状态与错误展示);② 新增 `UpdateBanner.vue` 顶部非模态横幅(新版本号 + 更新说明摘要 + 「立即更新」+ 可关闭),挂 App 外壳顶部(与 storage-banner 同位——更新是应用级状态,各页均可见)
- 静默检查挂点:`App.vue` `onMounted` 延迟触发(如 3s),**不进 `main.ts` 启动链**——不阻塞首帧,失败静默 catch
- 错误语义:静默路径吞掉一切;手动路径转为可读中文(网络失败/超时/清单无效)
- 语义色:更新提示用 `--accent`(非 `--danger`);失败态才用 `--danger`

备选「揉进 settings/ui store」被否:生命周期(启动即静默检查)与职责(安装进度)都不属于两者;独立 store 便于单测与归档后演进。

### D3: 纯浏览器 dev 兜底 = unsupported 态

`@tauri-apps/api` 在浏览器不可用。store 初始化时探测 Tauri 环境(与 persistence 内存兜底同一先例):非 Tauri → `unsupported`,「关于」区块退化为仅显示版本号(取 `package.json` version fallback),横幅不出现。避免 dev 控制台噪声与误报。

### D4: 签名密钥与 CI 接线(一次性操作,顺序敏感)

1. `npm run tauri signer generate` 生成 minisign 密钥对(设密码);**私钥 + 密码离线备份**(密码管理器),此步必须在首次 CI 构建前完成
2. 公钥明文入 `tauri.conf.json` `plugins.updater.pubkey`(随仓库,无保密性要求)
3. GitHub secrets:`TAURI_SIGNING_PRIVATE_KEY`(私钥内容)、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
4. `release.yml` 的 tauri-action step 增加上述两个 env + input `updaterJsonPreferNsis: true`(同时产出 NSIS/MSI 时 latest.json 指向 NSIS)
5. tauri-action 默认 `uploadUpdaterJson` / `uploadUpdaterSignatures` 为 true,四平台 matrix 经同一 tag 的 Release 汇总 latest.json——workflow 无需为此加 job

发布说明:`latest.json` 的 `notes` 取自 Release body;`releaseBody` 保留手写模板(内容含 changelog 摘要),首版实测字段透传是否符合预期(spec 已容忍缺失:仅显示版本号)。

### D5: 版本号获取

`getVersion()`(`@tauri-apps/api/app`)用于「已是最新」与「关于」区块的当前版本展示;比较逻辑在 updater 内核,前端不做版本运算,`domain/` 零改动。

## Risks / Trade-offs

- [私钥丢失 → 已装用户永久收不到更新] → 离线双备份进 tasks 验收项;极端情况只能靠新公钥发版 + 用户手动重装一次
- [macOS 未公证,更新替换 .app 后被 Gatekeeper 拦截(理论低概率:更新器解包替换不走浏览器 quarantine)] → 首个带更新器的版本发布后**必须实测**「旧版 → 更新 → 重启」;若被拦,macOS 降级为「提示 + 打开下载页」引导,其余平台不受影响
- [草稿→发布的手动步骤被遗忘 → 用户永远「已是最新」] → 有意设计的开关;在 README 发布流程处补一句提醒
- [Windows SmartScreen / macOS 首次安装 Gatekeeper 提示] → 既有安装包问题,非本次引入,不处理
- [四平台 matrix 写同一 latest.json 存在竞态] → tauri-action 官方示例工作流即此模式(后完成 job 覆盖汇总),tag 一次性触发,接受
- [v0.1.x 已装用户无更新器] → 冷启动事实:更新器覆盖从首个带它的版本(建议 v0.2.0)起,之前版本需手动装最后一次

## Migration Plan

顺序:密钥生成与备份(D4 步骤 1)→ GitHub secrets 配置 → 代码/配置合入(含 capabilities 增补 `updater:default`、`process:allow-restart`)→ 发 v0.2.0(草稿→手动发布)→ 实测更新链路(可用本地把版本号调低的构建当「旧版」验证,不等 v0.2.1)。回滚:代码正常 git revert;更新器侧出问题可删除 Release 的 latest.json 立即止血。无存储/数据迁移(更新状态不落盘)。

## Open Questions

- 横幅视觉细节(收起态/常驻高度)——实现时按 `design/DESIGN-GUIDE.md` 走 `$impeccable live` 迭代,不影响契约
- Release body(notes)的手写模板格式——首版发布时定,缺失已被 spec 容忍
