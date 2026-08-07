import { escapeHtml } from "./markdown-renderer.js";
import { LANGUAGE_EN, getLanguage } from "./i18n.js";

export function renderQualitySummary(container, quality) {
  const metrics = quality.metrics || {};
  const findings = (quality.findings || []).map((item) => typeof item === "string" ? item : item.message).filter(Boolean);
  const english = getLanguage() === LANGUAGE_EN;
  const values = [
    metrics.sourceCount === undefined ? "" : `${english ? "Evidence" : "证据片段"} ${metrics.evidenceRichCount || 0}/${metrics.sourceCount}`,
    metrics.importantClaimCount === undefined ? "" : `${english ? "Claim coverage" : "声明覆盖"} ${metrics.coveredClaimCount || 0}/${metrics.importantClaimCount}`,
    metrics.verifiedCitationCount === undefined ? "" : `${english ? "Verified citations" : "已核验引用"} ${metrics.verifiedCitationCount}`,
    metrics.traceableDocumentClaimCount === undefined ? "" : `${english ? "Traceable BP claims" : "可追溯 BP 声明"} ${metrics.traceableDocumentClaimCount}`,
    metrics.claimLedgerCount ? `${english ? "Supported claims" : "声明卡"} ${metrics.supportedLedgerClaimCount || 0}/${metrics.claimLedgerCount}${english ? "" : " 获支持"}` : "",
    metrics.auditedMetricCount ? `${english ? "Numeric checks" : "数字审计"} ${metrics.numericCheckCount || 0}` : "",
    metrics.marketScenarioCount ? `${english ? "Market scenarios" : "市场测算"} ${metrics.marketScenarioCount}` : "",
    metrics.competitorCount ? `${english ? "Competitors" : "竞品矩阵"} ${metrics.competitorCount}` : "",
    metrics.investmentVetoCount ? `${english ? "Veto conditions" : "否决条件"} ${metrics.investmentVetoCount}` : "",
    metrics.versionChangeCount ? `${english ? "Version changes" : "版本变化"} ${metrics.versionChangeCount}` : "",
    metrics.extractionCompleteness === undefined ? "" : `${english ? "Parse completeness" : "解析完整度"} ${Math.round(Number(metrics.extractionCompleteness) * 100)}%`
  ].filter(Boolean);
  container.innerHTML = `
    <div class="quality-metrics">${values.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>
    ${findings.length ? `<details><summary>${english ? `${findings.length} quality notices` : `${findings.length} 个质量提示`}</summary><ul>${findings.slice(0, 6).map((message) => `<li>${escapeHtml(message)}</li>`).join("")}</ul></details>` : ""}`;
  container.classList.toggle("hidden", !values.length && !findings.length);
}
