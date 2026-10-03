# src-tauri/capabilities/ — Tauri 权限范围

Tauri v2 的能力（capability）声明：主窗口可使用的插件权限与允许的远程地址。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| `default.json` | 主窗口权限：`core:default`、`opener:default`、`store:default`，以及 **http 白名单**——`https://**` / `http://**` 外加 `https://*:*` / `http://*:*`（URLPattern 语义下 `**` 不匹配带端口的 URL，带端口模式是为本地/自定义端点如 Ollama、LM Studio、自建服务放行，见 `docs/known-issues.md` 问题 1） |

修改 http 范围需同步评估安全面：当前策略是放行全部 http(s) 远程主机（用户可自由配置任意模型端点的产品前提），本地文件与 shell 等其他能力未开放。
