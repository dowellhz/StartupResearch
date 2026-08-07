import { reportSections } from "./review-prompts.js";
import { isEnglishOutput } from "./report-language.js";
import { hasEvidenceExcerpt, normalizeEvidenceSources } from "./research-evidence-service.js";
import { buildBpConclusionSummary, ensureLeadingSummary } from "./report-summary-service.js";

const OVERCLAIM_PATTERNS = [
  { code: "absence_as_fact", pattern: /(?:客户验证|经营收入|订单|收入)为零|无任何经营收入/g, message: "将未披露信息写成确认不存在" },
  { code: "fraud_without_conflict", pattern: /(?:极有可能|高度疑似|基本可以判断).{0,16}(?:虚构|造假|欺诈)|(?:虚构|造假|欺诈).{0,16}(?:极有可能|高度疑似)/g, message: "使用了证据要求很高的欺诈性定性" },
  { code: "search_absence_escalation", pattern: /(?:未检索到|未发现公开).{0,80}(?:因此|说明|表明).{0,40}(?:不存在|虚构|造假|为零)/g, message: "把检索缺失升级成事实结论" }
];

export function assessReportQuality(markdown, options = {}) {
  const text = String(markdown || "").trim();
  const findings = [];
  const sources = normalizeEvidenceSources(options.sources || []);
  const sourceCount = sources.length || Number(options.sourceCount || 0);
  const components = {
    structure: assessStructure(text, findings, options.outputLanguage),
    evidence: assessEvidence(text, { ...options, sources, sourceCount }, findings),
    extraction: assessExtraction(options.document, findings),
    reasoning: assessReasoning(text, sources, findings),
    identity: assessIdentity(options.companyIdentity, findings)
  };
  assessStructuredArtifacts(options, findings);
  assessEvidenceTrust(options.evidenceManifest, findings);
  const score = Object.values(components).reduce((sum, value) => sum + value, 0);
  const fatalCount = findings.filter((item) => item.severity === "fatal").length;
  return {
    ok: fatalCount === 0 && score >= 70,
    score,
    components,
    metrics: buildQualityMetrics({
      text,
      sources,
      crossCheck: options.crossCheck,
      document: options.document,
      businessAudit: options.businessAudit,
      claimLedger: options.claimLedger,
      investmentAnalysis: options.investmentAnalysis,
      evidenceManifest: options.evidenceManifest
    }),
    findings
  };
}

export function stabilizeReport(markdown, options = {}) {
  const companyName = options.companyName;
  const sourceCount = Number(options.sourceCount ?? options.sources?.length ?? 0);
  const english = isEnglishOutput(options.outputLanguage);
  const sections = reportSections(options.outputLanguage);
  let result = String(markdown || "").trim();
  if (!result) result = `# ${companyName || (english ? "Unnamed Company" : "未命名公司")} ${english ? "BP Review Report" : "BP 核查报告"}`;
  result = ensureLeadingSummary(result, english ? {
    heading: "Review Conclusion Summary",
    aliases: ["Conclusion Summary", "BP Review Summary"],
    fallback: "This report is a preliminary investment review. Material claims require independent verification through primary documents and due diligence."
  } : {
    heading: "核查结论摘要",
    aliases: ["内容核查结论摘要", "BP 核查结论摘要", "结论摘要"],
    fallback: buildBpConclusionSummary(options)
  });
  for (const section of sections) {
    if (!result.includes(`## ${section}`)) {
      result += `\n\n## ${section}\n\n${fallbackSection(section, sourceCount, english)}`;
    }
  }
  const gapPattern = english ? /public (?:sources|research).*(?:unavailable|insufficient|no usable)/i : /联网检索.*失败|公开来源不足/;
  if (!sourceCount && !gapPattern.test(result)) {
    result += english
      ? "\n\n> Review limitation: this run produced no usable public sources. The findings rely on BP claims and model analysis and require independent due diligence."
      : "\n\n> 核查限制：本次联网检索未形成可用公开来源，相关判断仅基于 BP 自述与模型分析，需独立尽调。";
  }
  return result.trim();
}

function assessStructure(text, findings, outputLanguage) {
  let score = 0;
  if (text.length >= 1800) score += 5;
  else findings.push(finding("report_too_short", "fatal", "报告正文过短"));
  let validSections = 0;
  const sections = reportSections(outputLanguage);
  for (const section of sections) {
    const count = text.split(`## ${section}`).length - 1;
    if (count === 1) validSections += 1;
    else findings.push(finding("section_invalid", "fatal", `章节“${section}”应出现一次，实际 ${count} 次`));
  }
  score += Math.round((validSections / sections.length) * 10);
  if (/\|[^\n]+\|[^\n]+\|/.test(text)) score += 5;
  else findings.push(finding("verification_table_missing", "fatal", "缺少关键声明核查表"));
  if (isEnglishOutput(outputLanguage) ? /(BP[- ]only|insufficient (?:data|evidence)|analytical inference)/i.test(text) : /(仅BP自述|资料不足|分析推断)/.test(text)) score += 5;
  else findings.push(finding("evidence_status_missing", "warn", "未明确区分自述与核验状态"));
  return score;
}

function assessEvidence(text, { sources, sourceCount, crossCheck, outputLanguage }, findings) {
  if (!sourceCount) {
    const disclosesGap = isEnglishOutput(outputLanguage)
      ? /(?:no usable|insufficient|unavailable).{0,40}public (?:sources|evidence)|public (?:sources|evidence).{0,40}(?:insufficient|unavailable)/i.test(text)
      : /(联网检索.*失败|未形成可核验.*公开|公开来源不足)/.test(text);
    if (!disclosesGap) {
      findings.push(finding("source_gap_not_disclosed", "warn", "联网来源为空但报告未披露限制"));
    }
    findings.push(finding("public_evidence_missing", "warn", "本次报告没有形成公开证据"));
    return 0;
  }
  let score = Math.min(5, sourceCount);
  const evidenceRichCount = sources.filter(hasEvidenceExcerpt).length;
  const evidenceRatio = safeRatio(evidenceRichCount, sources.length);
  score += Math.round(evidenceRatio * 10);
  if (sources.length && evidenceRatio < 0.5) {
    findings.push(finding("source_evidence_missing", "warn", `仅 ${evidenceRichCount}/${sources.length} 个来源包含可复核证据片段`));
  }
  const coverage = Array.isArray(crossCheck?.coverage) ? crossCheck.coverage : [];
  const coveredCount = coverage.filter((item) => item.status && item.status !== "unverified" || item.hasCandidateEvidence).length;
  const coverageRatio = coverage.length ? safeRatio(coveredCount, coverage.length) : evidenceRatio;
  score += Math.round(coverageRatio * 15);
  if (coverage.length && coverageRatio < 0.6) {
    findings.push(finding("claim_coverage_low", "warn", `高优先级声明证据覆盖 ${coveredCount}/${coverage.length}`));
  }
  const authorityRatio = safeRatio(sources.filter((source) => source.sourceTier !== "lead").length, sources.length);
  score += Math.round(authorityRatio * 5);
  if (sources.length && authorityRatio < 0.5) findings.push(finding("source_authority_low", "warn", "公开来源中线索型或低权威来源占比较高"));
  return Math.min(35, score);
}

function assessExtraction(document, findings) {
  if (!document) return 15;
  const pages = Array.isArray(document.pages) ? document.pages : [];
  const pageCount = Number(document.pageCount || pages.length || 0);
  const nonemptyPages = pages.filter((page) => meaningfulLength(page?.text) >= 40).length;
  const completeness = typeof document.extractionCompleteness === "number"
    ? document.extractionCompleteness
    : pageCount && pages.length ? safeRatio(nonemptyPages, pageCount) : 1;
  let score = Math.round(Math.max(0, Math.min(1, completeness)) * 10);
  if (completeness < 0.9) {
    findings.push(finding("extraction_incomplete", completeness < 0.7 ? "fatal" : "warn", `BP 页面解析完整度约 ${Math.round(completeness * 100)}%`));
  }
  if (document.extractionWarning) findings.push(finding("extraction_warning", "warn", String(document.extractionWarning)));
  else score += 5;
  return Math.min(15, score);
}

function assessReasoning(text, sources, findings) {
  let score = 15;
  for (const rule of OVERCLAIM_PATTERNS) {
    const matches = text.match(rule.pattern) || [];
    if (!matches.length) continue;
    score -= Math.min(6, matches.length * 3);
    findings.push(finding(rule.code, "warn", `${rule.message}（${matches.length} 处）`));
  }
  const allowedUrls = new Set(sources.map((source) => source.url));
  const reportUrls = Array.from(text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g), (match) => normalizeUrl(match[1])).filter(Boolean);
  const outsideUrls = Array.from(new Set(reportUrls.filter((url) => !allowedUrls.has(url))));
  if (outsideUrls.length) {
    score -= Math.min(5, outsideUrls.length * 2);
    findings.push(finding("citation_provenance_invalid", "warn", `报告引用了 ${outsideUrls.length} 个未进入证据列表的链接`));
  }
  return Math.max(0, score);
}

function assessIdentity(identity, findings) {
  if (!identity) return 10;
  if (identity.confidence === "high") return 10;
  if (identity.confidence === "medium") return 8;
  findings.push(finding("company_identity_low", "warn", identity.warning || "公司主体识别置信度较低"));
  return identity.acceptedName ? 4 : 0;
}

function assessStructuredArtifacts({ businessAudit, claimLedger, investmentAnalysis }, findings) {
  const auditSummary = businessAudit?.summary || {};
  const ledgerSummary = claimLedger?.summary || {};
  if (auditSummary.conflictCount) {
    findings.push(finding("business_metric_conflict", "warn", `BP 数字与经营假设审计发现 ${auditSummary.conflictCount} 项冲突`));
  }
  if (ledgerSummary.conflicted) {
    findings.push(finding("claim_evidence_conflict", "warn", `${ledgerSummary.conflicted} 条关键声明存在公开证据冲突`));
  }
  if (ledgerSummary.highPriorityOpen) {
    findings.push(finding("high_priority_claims_open", "warn", `${ledgerSummary.highPriorityOpen} 条高优先级声明仍缺少直接公开证据`));
  }
  if (investmentAnalysis?.marketSizing?.status === "not_calculable") {
    findings.push(finding("market_sizing_not_calculable", "warn", "市场规模缺少足够参数，暂无法形成自下而上测算"));
  }
}

function assessEvidenceTrust(manifest, findings) {
  if (!manifest?.summary) return;
  const open = Number(manifest.summary.openHighPriorityDocumentCitations || 0);
  const failed = Number(manifest.summary.failedCitations || 0);
  if (open) {
    findings.push(finding(
      "high_priority_citation_unverified",
      "fatal",
      `${open} 条高优先级声明缺少可在 BP 原文中复核的逐字引用`
    ));
  }
  if (failed) findings.push(finding("citation_quote_not_found", "warn", `${failed} 条引用未能在对应来源中定位`));
}

function buildQualityMetrics({ text, sources, crossCheck, document, businessAudit, claimLedger, investmentAnalysis, evidenceManifest }) {
  const evidenceRichCount = sources.filter(hasEvidenceExcerpt).length;
  const coverage = Array.isArray(crossCheck?.coverage) ? crossCheck.coverage : [];
  const coveredClaimCount = coverage.filter((item) => item.status && item.status !== "unverified" || item.hasCandidateEvidence).length;
  return {
    sourceCount: sources.length,
    evidenceRichCount,
    evidenceCoverage: safeRatio(evidenceRichCount, sources.length),
    importantClaimCount: coverage.length,
    coveredClaimCount,
    claimCoverage: safeRatio(coveredClaimCount, coverage.length),
    primarySourceCount: sources.filter((source) => source.sourceTier === "primary").length,
    claimLedgerCount: Number(claimLedger?.summary?.total || 0),
    supportedLedgerClaimCount: Number(claimLedger?.summary?.supported || 0),
    conflictedLedgerClaimCount: Number(claimLedger?.summary?.conflicted || 0),
    auditedMetricCount: Number(businessAudit?.summary?.metricCount || 0),
    numericCheckCount: Number(businessAudit?.summary?.checkCount || 0),
    numericConflictCount: Number(businessAudit?.summary?.conflictCount || 0),
    marketScenarioCount: Number(investmentAnalysis?.marketSizing?.scenarios?.length || 0),
    competitorCount: Number(investmentAnalysis?.competitorMatrix?.rows?.length || 0),
    investmentVetoCount: Number(investmentAnalysis?.decision?.vetoItems?.length || 0),
    versionChangeCount: Number(investmentAnalysis?.versionComparison?.changes?.length || 0),
    verifiedCitationCount: Number(evidenceManifest?.summary?.verifiedCitations || 0),
    traceableDocumentClaimCount: Number(evidenceManifest?.summary?.traceableDocumentClaims || 0),
    openHighPriorityDocumentCitationCount: Number(evidenceManifest?.summary?.openHighPriorityDocumentCitations || 0),
    reportCharacterCount: text.length,
    extractionCompleteness: Number(document?.extractionCompleteness ?? 1)
  };
}

function fallbackSection(section, sourceCount, english = false) {
  if (english && section === "Key Claims Verification Table") {
    return "| Claim | BP Evidence | Public Verification | Assessment | Confidence | Next Step |\n|---|---|---|---|---|---|\n| Key operating and market claims | See uploaded material | Insufficient evidence in this run | Insufficient evidence | Low | Obtain underlying data and verify through interviews |";
  }
  if (english && section === "References") return sourceCount ? "See citations in the report body." : "No usable public sources were produced in this run.";
  if (english) return "The available material is insufficient; verify this area through subsequent due diligence.";
  if (section === "关键声明核查表") {
    return "| 声明 | BP依据 | 公开核验 | 判断 | 置信度 | 下一步 |\n|---|---|---|---|---|---|\n| 关键经营与市场声明 | 见上传材料 | 本次未形成充分证据 | 资料不足 | 低 | 索取底层数据并访谈核实 |";
  }
  if (section === "参考来源") return sourceCount ? "详见正文引用。" : "本次未形成可用公开来源。";
  return "本次材料不足，建议在后续尽调中补充核实。";
}

function finding(code, severity, message) {
  return { code, severity, message };
}

function safeRatio(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 1000 : 0;
}

function meaningfulLength(value) {
  return String(value || "").replace(/\s+/g, "").length;
}

function normalizeUrl(value) {
  try {
    return new URL(String(value || "").trim()).toString();
  } catch {
    return "";
  }
}
