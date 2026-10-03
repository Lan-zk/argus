# src-tauri/src/ — Rust 源码

刻意保持很薄：只有钥匙串 command 与插件注册，没有业务逻辑。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| `main.rs` | 标准入口：调用 lib 的 `run()`；release 下屏蔽 Windows 控制台窗口 |
| `lib.rs` | 插件注册（opener / **http** / **store**）与 command：`keyring_set` / `keyring_get` / `keyring_delete` / `keyring_probe`（写入→读回→删除的自检，供设置页诊断展示）；debug 构建额外暴露 `dev_spike_read/write`（应用数据目录读写 spike 文件，仅供联调，release 不编译） |

## 约定

- 钥匙串统一服务名 `com.argus.review`，条目 user = 模型配置 id；前端封装见 [`src/lib/keyring.ts`](../../src/lib/README.md)。
- 模型请求不走 Rust 自定义代码，而是经 tauri http 插件通道（前端 `globalThis.fetch` 被替换为插件 fetch），因此这里没有 http 相关 command。
- `#[cfg(test)]` 内含钥匙串读写往返测试：`cargo test` 会真实写入 macOS 登录钥匙串并在结束时删除条目。
