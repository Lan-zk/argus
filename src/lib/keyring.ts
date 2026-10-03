// API Key 安全存取（spec: app-persistence 安全两场景 / design 决策 3）。
// Rust 侧 keyring command 封装：保存写钥匙串（条目 user = 配置 id）、按需短路径读取。
// Key 永不进入 JSON 数据文件、永不进入日志。

import { isTauri } from "./tauri";

const invoke = async <T>(cmd: string, args: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
};

export const keyring = {
  /** 保存 Key 到系统钥匙串。开发模式（纯浏览器）下降级到内存表。 */
  async set(configId: string, apiKey: string): Promise<void> {
    if (!isTauri()) {
      memoryStore.set(configId, apiKey);
      return;
    }
    await invoke("keyring_set", { user: configId, password: apiKey });
  },

  /** 运行时短路径读取；不存在返回 null。 */
  async get(configId: string): Promise<string | null> {
    if (!isTauri()) return memoryStore.get(configId) ?? null;
    return invoke<string | null>("keyring_get", { user: configId });
  },

  async delete(configId: string): Promise<void> {
    if (!isTauri()) {
      memoryStore.delete(configId);
      return;
    }
    await invoke("keyring_delete", { user: configId });
  },

  /** 钥匙串可用性自检（设置页诊断）。 */
  async probe(configId: string): Promise<{ service: string; user: string; roundtrip: boolean }> {
    if (!isTauri()) {
      return { service: "memory(dev)", user: configId, roundtrip: true };
    }
    return invoke("keyring_probe", { user: configId });
  },
};

// 开发模式（纯 vite 无 Tauri）的内存兜底，避免 UI 调试崩溃
const memoryStore = new Map<string, string>();
