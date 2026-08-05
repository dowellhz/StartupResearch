import { escapeHtml } from "./markdown-renderer.js";

export function renderQualitySummary(container, quality) {
  const metrics = quality.metrics || {};
  const findings = (quality.findings || []).map((item) => typeof item === "string" ? item : item.message).filter(Boolean);
  const values = [
    metrics.sourceCount === undefined ? "" : `证据片段 ${metrics.evidenceRichCount || 0}/${metrics.sourceCount}`,
    metrics.importantClaimCount === undefined ? "" : `声明覆盖 ${metrics.coveredClaimCount || 0}/${metrics.importantClaimCount}`,
    metrics.claimLedgerCount ? `声明卡 ${metrics.supportedLedgerClaimCount || 0}/${metrics.claimLedgerCount} 获支持` : "",
    metrics.auditedMetricCount ? `数字审计 ${metrics.numericCheckCount || 0} 项检查` : "",
    metrics.marketScenarioCount ? `市场测算 ${metrics.marketScenarioCount} 个情景` : "",
    metrics.competitorCount ? `竞品矩阵 ${metrics.competitorCount} 项` : "",
    metrics.investmentVetoCount ? `否决条件 ${metrics.investmentVetoCount} 项` : "",
    metrics.versionChangeCount ? `版本变化 ${metrics.versionChangeCount} 项` : "",
    metrics.extractionCompleteness === undefined ? "" : `解析完整度 ${Math.round(Number(metrics.extractionCompleteness) * 100)}%`
  ].filter(Boolean);
  container.innerHTML = `
    <div class="quality-metrics">${values.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>
    ${findings.length ? `<details><summary>${findings.length} 个质量提示</summary><ul>${findings.slice(0, 6).map((message) => `<li>${escapeHtml(message)}</li>`).join("")}</ul></details>` : ""}`;
  container.classList.toggle("hidden", !values.length && !findings.length);
}
