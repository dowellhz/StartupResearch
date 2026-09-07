import { localizeApiError } from "./api-error-messages.js";
import { t } from "./i18n.js";

export async function requestJson(url, options = {}, fetchImpl = globalThis.fetch) {
  const method = String(options.method || "GET").toUpperCase();
  const response = await requestResponse(url, options, { fetchImpl, retry: method === "GET" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw apiError(payload, response.status);
  return payload;
}

export async function requestResponse(url, options = {}, { fetchImpl = globalThis.fetch, retry = false } = {}) {
  try {
    return await fetchImpl(url, options);
  } catch {
    if (retry) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      try {
        return await fetchImpl(url, options);
      } catch {}
    }
    throw new Error(t("apiError.offline", { zh: "暂时无法连接本地服务，请稍后重试或刷新页面" }));
  }
}

// 错误消息在这里统一本地化，所有调用方继续用 error.message 即可；
// code / status / requestId 一并保留，便于上报和分支处理。
function apiError(payload, status) {
  const message = payload?.error || t("apiError.status", { zh: `请求失败 (${status})`, status });
  return Object.assign(new Error(localizeApiError({ code: payload?.code, message })), {
    code: payload?.code || "",
    status,
    requestId: payload?.requestId || ""
  });
}
