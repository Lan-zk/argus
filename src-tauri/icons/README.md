# src-tauri/icons/ — 应用图标（生成物）

`tauri icon` 命令的生成产物：macOS `icon.icns`、Windows `icon.ico`、各尺寸 png 以及 android / ios 全套。**不要手改**，需要换图标时：

```bash
npm run tauri icon <1024x1024 源图路径>
```

图标设计源文件（SVG/PNG 原稿与设计说明）在 [`design/icons/`](../../design/icons/README.md)。最近一次更换见提交 `2aff45b chore: 更换应用图标（tauri icon 全套生成）`。
