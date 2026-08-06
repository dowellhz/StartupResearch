import { resolveIndustryResearchTemplate } from "./industry-research-prompts.js";
import { isEnglishOutput } from "./report-language.js";

export function stabilizeIndustryResearchReport(markdown, { topic, outputLanguage, researchTemplate, sources = [] } = {}) {
  const english = isEnglishOutput(outputLanguage);
  const selected = resolveIndustryResearchTemplate(researchTemplate, outputLanguage);
  let report = String(markdown || "").trim() || `# ${topic || (english ? "Untitled Topic" : "未命名主题")} · ${selected.label}`;
  const sections = [english ? "Research Conclusion Summary" : "研究结论摘要", ...selected.sections, english ? "References" : "参考来源"];
  for (const section of sections) {
    if (!report.includes(`## ${section}`)) report += `\n\n## ${section}\n\n${fallback(section, sources, english)}`;
  }
  return report.trim();
}

export function assessIndustryResearchQuality(markdown, { outputLanguage, researchTemplate, sources = [], synthesis = {}, warnings = [] } = {}) {
  const english = isEnglishOutput(outputLanguage);
  const selected = resolveIndustryResearchTemplate(researchTemplate, outputLanguage);
  const required = [english ? "Research Conclusion Summary" : "研究结论摘要", ...selected.sections, english ? "References" : "参考来源"];
  const present = required.filter((section) => String(markdown).includes(`## ${section}`)).length;
  const findings = [];
  const sourceCount = sources.length;
  const factCount = Array.isArray(synthesis.findings) ? synthesis.findings.length : 0;
  let score = Math.round((present / required.length) * 30);
  score += String(markdown).length >= 2200 ? 20 : String(markdown).length >= 1200 ? 12 : 5;
  score += Math.min(25, sourceCount * 3);
  score += Math.min(15, factCount * 2);
  score += citationUrlsAreKnown(markdown, sources) ? 10 : 0;
  if (present < required.length) findings.push(item("missing_sections", "fatal", "行业研究报告章节不完整"));
  if (!sourceCount) findings.push(item("no_public_sources", "fatal", "行业研究未形成可引用来源"));
  if (!factCount) findings.push(item("no_structured_findings", "warn", "公开来源未形成结构化行业事实"));
  if (!citationUrlsAreKnown(markdown, sources)) findings.push(item("citation_provenance_invalid", "warn", "报告包含证据列表之外的链接"));
  for (const warning of warnings.filter(Boolean)) findings.push(item("pipeline_warning", "warn", warning));
  return {
    ok: findings.every((entry) => entry.severity !== "fatal") && score >= 65,
    score: Math.max(0, Math.min(100, score)),
    components: { structure: present, sourceCount, factCount },
    metrics: { sourceCount, findingCount: factCount, reportCharacterCount: String(markdown).length },
    findings
  };
}

function citationUrlsAreKnown(markdown, sources) {
  const known = new Set(sources.map((source) => source.url));
  return Array.from(String(markdown).matchAll(/\]\((https?:\/\/[^)\s]+)\)/g), (match) => match[1]).every((url) => known.has(url));
}

function fallback(section, sources, english = false) {
  if (english && section === "References") return sources.length ? sources.map((item) => `- [${item.title}](${item.url})`).join("\n") : "No usable public sources were produced in this run.";
  if (english) return "This public-source search produced insufficient evidence; continue targeted verification.";
  if (section === "参考来源") return sources.length ? sources.map((item) => `- [${item.title}](${item.url})`).join("\n") : "本次公开检索未形成可引用来源。";
  return "本次公开检索未形成足够证据，建议继续定向核验。";
}

function item(code, severity, message) {
  return { code, severity, message };
}
