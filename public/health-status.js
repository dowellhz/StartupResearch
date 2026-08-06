import { t } from "./i18n.js";

export async function refreshHealthStatus({ requestJson, modelDot, modelText }) {
  try {
    const payload = await requestJson("/api/health");
    modelDot.className = `status-dot ${payload.modelConfigured ? "online" : "offline"}`;
    modelText.textContent = payload.modelConfigured ? t("health.connected", { zh: `${payload.model} 已连接`, model: payload.model }) : t("health.notConfigured", { zh: "DeepSeek 未配置" });
  } catch {
    modelDot.className = "status-dot offline";
    modelText.textContent = t("health.unavailable", { zh: "服务不可用" });
  }
}
