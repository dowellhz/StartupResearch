import { COMPANY_RESEARCH_SECTIONS } from "./company-pre-research-prompts.js";
import { buildCompanyResearchConclusionSummary, ensureLeadingSummary } from "./report-summary-service.js";

export function stabilizeCompanyResearchReport(markdown, options = {}) {
  const companyName = options.companyName;
  const sourceCount = Number(options.sourceCount ?? options.sources?.length ?? 0);
  let result = String(markdown || "").trim() || `# ${companyName || "未命名公司"} 公司预研报告`;
  result = ensureLeadingSummary(result, {
    heading: "预研结论摘要",
    aliases: ["公司预研结论摘要", "结论摘要"],
    fallback: buildCompanyResearchConclusionSummary(options)
  });
  for (const section of COMPANY_RESEARCH_SECTIONS) {
    if (!result.includes(`## ${section}`)) result += `\n\n## ${section}\n\n${fallbackSection(section, sourceCount)}`;
  }
  if (!sourceCount && !/公开检索.*未形成|公开来源不足/.test(result)) {
    result += "\n\n> 预研限制：本次公开检索未形成可引用来源，所有结论均需后续尽调验证。";
  }
  return result.trim();
}

export function assessCompanyResearchQuality(markdown, { sources = [], analysis = {}, generationWarning = "", researchWarning = "" } = {}) {
  const text = String(markdown || "");
  const findings = [];
  const presentSections = COMPANY_RESEARCH_SECTIONS.filter((section) => text.includes(`## ${section}`)).length;
  const sourceCount = Array.isArray(sources) ? sources.length : 0;
  const factCount = Array.isArray(analysis.findings) ? analysis.findings.length : 0;
  const validUrls = new Set(sources.map((source) => source.url));
  const citedUrls = Array.from(text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g), (match) => match[1]);
  const outsideUrls = Array.from(new Set(citedUrls.filter((url) => !validUrls.has(url))));
  let score = Math.min(25, Math.round((presentSections / COMPANY_RESEARCH_SECTIONS.length) * 25));
  score += text.length >= 1600 ? 20 : text.length >= 800 ? 12 : 5;
  score += Math.min(25, sourceCount * 3);
  score += Math.min(20, factCount * 2);
  score += outsideUrls.length ? 0 : 10;
  if (!sourceCount) findings.push(item("no_public_sources", "fatal", researchWarning || "本次公开检索未形成可引用来源"));
  if (presentSections < COMPANY_RESEARCH_SECTIONS.length) findings.push(item("missing_sections", "fatal", "公司预研报告章节不完整"));
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

function fallbackSection(section, sourceCount) {
  if (section === "参考来源") return sourceCount ? "详见正文引用。" : "本次公开检索未形成可引用来源。";
  return "本次公开资料不足，建议在后续尽调中补充核实。";
}

function item(code, severity, message) {
  return { code, severity, message };
}
