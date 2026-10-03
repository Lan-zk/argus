# public/ — 公共静态资源

Vite 的公共目录：内容原样拷贝到构建产物根（`dist/`），按绝对路径引用（如 `/icon.png`），不参与 import 与 hash 指纹；需要构建处理的资源放 [`src/assets/`](../src/assets/README.md)。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| `icon.png` | 应用图标：顶部导航品牌位使用（`App.vue` 中 `/icon.png`），也是 `tauri icon` 的源图之一 |
