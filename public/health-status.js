export async function refreshHealthStatus({ requestJson, modelDot, modelText }) {
  try {
    const payload = await requestJson("/api/health");
    modelDot.className = `status-dot ${payload.modelConfigured ? "online" : "offline"}`;
    modelText.textContent = payload.modelConfigured ? `${payload.model} 已连接` : "DeepSeek 未配置";
  } catch {
    modelDot.className = "status-dot offline";
    modelText.textContent = "服务不可用";
  }
}
