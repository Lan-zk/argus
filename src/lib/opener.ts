// 外链打开（安全审计修复）：文档内链接不得进入 WebView 导航（防钓鱼/替换应用界面），
// 统一经系统浏览器/系统处理器打开。scheme 白名单单一来源：parser.isSafeLinkHref。

import { isTauri } from "./tauri";
import { isSafeLinkHref } from "../domain/parser";

/** 打开外部链接：仅放行 http(s)/mailto；Tauri 内经 opener 插件，浏览器开发环境退回 window.open。 */
export async function openExternal(rawHref: string): Promise<void> {
  const href = rawHref.trim();
  if (!isSafeLinkHref(href)) return;
  if (!isTauri()) {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(href);
  } catch {
    // opener 权限未覆盖或调用失败：静默放弃，不产生任何导航
  }
}
