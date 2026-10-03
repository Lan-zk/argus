# .github/ — GitHub 配置

CI/CD 与仓库配置。

## 目录结构

| 路径 | 职责 |
| --- | --- |
| `workflows/release.yml` | 发布工作流：推送 `v*` tag 或手动触发；四平台矩阵——macOS arm64 / x64（`.app` + `.dmg`）、Windows x64（NSIS `.exe` + MSI）、Ubuntu（`.deb` + `.AppImage`）；用 tauri-action 构建、上传附件并创建 **Draft Release**（`v__VERSION__`，确认后手动发布） |
