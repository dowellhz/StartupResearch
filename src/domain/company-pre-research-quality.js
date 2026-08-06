import { companyResearchSections } from "./company-pre-research-prompts.js";
import { isEnglishOutput } from "./report-language.js";
import { buildCompanyResearchConclusionSummary, ensureLeadingSummary } from "./report-summary-service.js";

export function stabilizeCompanyResearchReport(markdown, options = {}) {
  const companyName = options.companyName;
  const sourceCount = Number(options.sourceCount ?? options.sources?.length ?? 0);
  const english = isEnglishOutput(options.outputLanguage);
  const sections = companyResearchSections(options.outputLanguage);
  let result = String(markdown || "").trim() || `# ${companyName || (english ? "Unnamed Company" : "未命名公司")} ${english ? "Company Research Report" : "公司预研报告"}`;
  result = ensureLeadingSummary(result, english ? {
    heading: "Research Conclusion Summary",
    aliases: ["Conclusion Summary", "Company Research Summary"],
    fallback: "This preliminary public-source review requires verification through company materials and independent due diligence."
  } : {
    heading: "预研结论摘要",
    aliases: ["公司预研结论摘要", "结论摘要"],
    fallback: buildCompanyResearchConclusionSummary(options)
  });
  for (const section of sections) {
    if (!result.includes(`## ${section}`)) result += `\n\n## ${section}\n\n${fallbackSection(section, sourceCount, english)}`;
  }
  const disclosesGap = english ? /no usable public sources|public (?:sources|information).*(?:insufficient|unavailable)/i.test(result) : /公开检索.*未形成|公开来源不足/.test(result);
  if (!sourceCount && !disclosesGap) {
    result += english
      ? "\n\n> Research limitation: this run produced no usable public sources; all conclusions require subsequent due diligence."
      : "\n\n> 预研限制：本次公开检索未形成可引用来源，所有结论均需后续尽调验证。";
  }
  return result.trim();
}

export function assessCompanyResearchQuality(markdown, { outputLanguage, sources = [], analysis = {}, generationWarning = "", researchWarning = "" } = {}) {
  const text = String(markdown || "");
  const findings = [];
  const sections = companyResearchSections(outputLanguage);
  const presentSections = sections.filter((section) => text.includes(`## ${section}`)).length;
  const sourceCount = Array.isArray(sources) ? sources.length : 0;
  const factCount = Array.isArray(analysis.findings) ? analysis.findings.length : 0;
  const validUrls = new Set(sources.map((source) => source.url));
  const citedUrls = Array.from(text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g), (match) => match[1]);
  const outsideUrls = Array.from(new Set(citedUrls.filter((url) => !validUrls.has(url))));
  let score = Math.min(25, Math.round((presentSections / sections.length) * 25));
  score += text.length >= 1600 ? 20 : text.length >= 800 ? 12 : 5;
  score += Math.min(25, sourceCount * 3);
  score += Math.min(20, factCount * 2);
  score += outsideUrls.length ? 0 : 10;
  if (!sourceCount) findings.push(item("no_public_sources", "fatal", researchWarning || "本次公开检索未形成可引用来源"));
  if (presentSections < sections.length) findings.push(item("missing_sections", "fatal", "公司预研报告章节不完整"));
  if (outsideUrls.length) findings.push(item("citation_provenance_invalid", "warn", `报告引用了 ${outsideUrls.length} 个未进入证据列表的链接`));
  if (generationWarning) findings.push(item("generation_warning", "warn", generationWarning));
  if (!factCount) findings.push(item("no_structured_findings", "warn", "公开资料未形成结构化事实清单"));
  return {
    ok: findings.every((finding) => finding.severity !== "fatal") && score >= 65,
    score: Math.max(0, Math.min(100, score)),
    components: { structure: presentSections, sourceCount, factCount },
    metrics: { sourceCount, evidenceRichCount: sources.filter((source) => String(source.snippet || "").trim().length >= 12).length, findingCount: factCount, reportCharacterCount: text.length },
    findings
  };
}

function fallbackSection(section, sourceCount, english = false) {
  if (english && section === "References") return sourceCount ? "See citations in the report body." : "No usable public sources were produced in this run.";
  if (english) return "The available public information is insufficient; verify this area through subsequent due diligence.";
  if (section === "参考来源") return sourceCount ? "详见正文引用。" : "本次公开检索未形成可引用来源。";
  return "本次公开资料不足，建议在后续尽调中补充核实。";
}

function item(code, severity, message) {
  return { code, severity, message };
}
