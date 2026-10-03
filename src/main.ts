// 应用入口（design 决策 1）：fetch 通道替换 + Pinia + 领域日志挂接。
// 初始化前移（spec: theme-system 启动无样式闪烁）：mount 前恢复偏好并应用皮肤，首帧即目标主题。
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles/tokens.css";
import "./styles/base.css";
import { installTauriFetch, isTauri } from "./lib/tauri";
import { useSettingsStore } from "./stores/settings";
import { useThemeStore } from "./stores/theme";

async function bootstrap() {
  // Spike（tasks 1.3）：Tauri WebView 内把全局 fetch 换成 tauri http fetch。
  // pi-ai 及其内部 SDK 全部走该通道（含拒绝自定义 fetch 的 Google 适配器）；
  // 纯 vite 开发模式保留原生 fetch。
  const replaced = await installTauriFetch();
  if (replaced) {
    console.info("[argus] globalThis.fetch → tauri http plugin（模型请求经 Rust 通道，免 CORS）");
  } else if (!isTauri()) {
    console.info("[argus] 浏览器开发模式：使用原生 fetch");
  }

  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);

  // 主题首帧：读取持久化偏好 → 应用 data-theme → 再 mount（Tauri 本地 store 毫秒级，无可感知延迟）。
  await useSettingsStore(pinia).init();
  useThemeStore(pinia).start();

  app.mount("#app");
}

void bootstrap();
