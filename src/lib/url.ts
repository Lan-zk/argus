// 自定义端点 URL 检查（安全审计修复）：非本机明文 http:// 端点会让 API Key 未加密上网，需向用户告警。

/** 解析 Base URL；非法返回 null（由调用方决定提示方式）。 */
export function parseEndpointUrl(baseUrl: string): URL | null {
  try {
    return new URL(baseUrl.trim());
  } catch {
    return null;
  }
}

/** 是否非本机的明文 http 端点（localhost / 127.0.0.1 / [::1] 视为本机，不告警）。 */
export function isPlainHttpRemote(baseUrl: string): boolean {
  const u = parseEndpointUrl(baseUrl);
  if (!u || u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase();
  return h !== "localhost" && !h.endsWith(".localhost") && h !== "127.0.0.1" && h !== "[::1]" && h !== "::1";
}
