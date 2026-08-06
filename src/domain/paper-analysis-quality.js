import { paperAnalysisSections } from "./paper-analysis-prompts.js";
import { isEnglishOutput } from "./report-language.js";

export function stabilizePaperAnalysisReport(markdown, { title, outputLanguage, sources = [], sourceUrl = "" } = {}) {
  const english = isEnglishOutput(outputLanguage);
  const sections = paperAnalysisSections(outputLanguage);
  let report = String(markdown || "").trim() || `# ${title || (english ? "Untitled Paper" : "未命名论文")} · ${english ? "Paper Analysis" : "论文解读"}`;
  for (const section of sections) {
    if (!report.includes(`## ${section}`)) report += `\n\n## ${section}\n\n${fallback(section, sources, sourceUrl, english)}`;
  }
  return report.trim();
}

export function assessPaperAnalysisQuality(markdown, { outputLanguage, document = {}, metadata = {}, sources = [], sourceUrl = "", warnings = [] } = {}) {
  const text = String(markdown || "");
  const sections = paperAnalysisSections(outputLanguage);
  const present = sections.filter((section) => text.includes(`## ${section}`)).length;
  const technical = isEnglishOutput(outputLanguage) ? ["Technical Problem", "Method Architecture", "Core Algorithms or Formulas", "Training or Inference Workflow", "Experimental Design and Metrics", "Engineering Constraints", "Reproduction Challenges"] : ["技术问题", "方法架构", "核心算法或公式", "训练或推理流程", "实验设计与指标", "工程实现约束", "复现难点"];
  const technicalPresent = technical.filter((section) => text.includes(`### ${section}`)).length;
  const findings = [];
  let score = Math.round((present / sections.length) * 25);
  score += Math.round((technicalPresent / technical.length) * 20);
  score += text.length >= 2600 ? 20 : text.length >= 1400 ? 12 : 5;
  score += String(document.text || "").length >= 1000 ? 20 : 5;
  score += metadata.title ? 5 : 0;
  score += sources.length || sourceUrl ? 10 : 0;
  if (present < sections.length) findings.push(item("missing_sections", "fatal", "论文解读章节不完整"));
  if (technicalPresent < technical.length) findings.push(item("missing_technical_sections", "warn", "技术实现讲解缺少部分固定子栏目"));
  if (String(document.text || "").length < 1000) findings.push(item("paper_text_short", "fatal", "论文正文有效文本过短"));
  if (!metadata.title) findings.push(item("paper_title_missing", "warn", "未能稳定识别论文标题"));
  for (const warning of warnings.filter(Boolean)) findings.push(item("pipeline_warning", "warn", warning));
  return { ok: findings.every((entry) => entry.severity !== "fatal") && score >= 65, score: Math.max(0, Math.min(100, score)), components: { structure: present, technicalStructure: technicalPresent, sourceCount: sources.length }, metrics: { sourceCount: sources.length, paperCharacterCount: String(document.text || "").length, reportCharacterCount: text.length }, findings };
}

function fallback(section, sources, sourceUrl, english = false) {
  if (english && section === "References") {
    const values = [...sources, ...(sourceUrl ? [{ title: "Original paper", url: sourceUrl }] : [])];
    return values.length ? values.map((item) => `- [${item.title}](${item.url})`).join("\n") : "No external citable sources were produced in this run.";
  }
  if (english) return "The available evidence is insufficient; verify this point against the full paper.";
  if (section === "参考来源") {
    const values = [...sources, ...(sourceUrl ? [{ title: "论文原文", url: sourceUrl }] : [])];
    return values.length ? values.map((item) => `- [${item.title}](${item.url})`).join("\n") : "本次未形成外部可引用来源。";
  }
  return "现有证据不足，需结合论文原文继续核验。";
}

function item(code, severity, message) { return { code, severity, message }; }
