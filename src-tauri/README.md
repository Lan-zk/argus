# src-tauri/ — Rust 壳（Tauri v2）

Tauri 桌面壳：承载 WebView、注册插件（http / store / opener）与钥匙串 command。业务逻辑全部在前端 [`src/`](../src/README.md)，这里保持尽量薄。

## 目录与文件

| 路径 | 职责 |
| --- | --- |
| [`src/`](./src/README.md) | Rust 源码：`keyring_set/get/delete/probe` command 与插件注册；`main.rs` 为入口 |
| [`capabilities/`](./capabilities/README.md) | Tauri 权限范围：http 远程域名白名单、store、opener |
| `icons/` | 应用图标全套（icns / ico / 各尺寸 png 及 android/ios 目录），由 `npm run tauri icon <源图>` 生成，勿手改 |
| `gen/schemas/` | Tauri 自动生成的 schema（已 gitignore） |
| `tauri.conf.json` | 应用配置：窗口（1240×800，标题「Argus — AI 文稿审阅」）、构建命令、打包目标 |
| `Cargo.toml` | Rust 依赖：tauri、http/store/opener 插件、keyring、serde；release profile 开启 lto/strip 瘦身 |
| `build.rs` | tauri-build 标准构建脚本 |

## 常用命令

```bash
npm run tauri dev      # 开发（自动先起 vite）
npm run tauri build    # 打包 .app / .dmg
cargo test             # Rust 侧测试（含钥匙串读写往返，会真实写 macOS 登录钥匙串）
```
