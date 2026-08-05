export async function requestJson(url, options = {}, fetchImpl = globalThis.fetch) {
  const method = String(options.method || "GET").toUpperCase();
  const response = await requestResponse(url, options, { fetchImpl, retry: method === "GET" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `请求失败 (${response.status})`);
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
    throw new Error("暂时无法连接本地服务，请稍后重试或刷新页面");
  }
}
