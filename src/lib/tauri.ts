// Tauri 运行环境检测与网络通道（design 决策 1 spike）。
// 在 Tauri WebView 内运行时，应用入口把 globalThis.fetch 替换为 tauri http fetch：
// 请求从 Rust 侧发出，天然免 CORS、绕过 WebView CSP，四类 Provider（含拒绝自定义 fetch 的
// Google 适配器）统一走该通道。纯 vite 开发模式保留原生 fetch 以便浏览器调试。

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let replaced = false;

/**
 * 应用入口调用一次（async：动态加载插件模块）。返回是否发生了替换（开发模式返回 false）。
 * 替换后 pi-ai 及其内部 SDK（openai/anthropic/google）的全部模型请求经 Tauri http 通道。
 */
export async function installTauriFetch(): Promise<boolean> {
  if (replaced || !isTauri()) return false;
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  const original = globalThis.fetch.bind(globalThis);
  const wrapped: typeof globalThis.fetch = (input, init) => {
    // 相对路径（本地资源）不走 Tauri 通道
    if (typeof input === "string" && !/^https?:\/\//i.test(input)) return original(input, init);
    if (input instanceof URL && input.protocol !== "http:" && input.protocol !== "https:")
      return original(input, init);
    return tauriFetch(input as Parameters<typeof tauriFetch>[0], init);
  };
  globalThis.fetch = wrapped;
  replaced = true;
  return true;
}
