import { PAPER_ANALYSIS_SECTIONS } from "./paper-analysis-prompts.js";

export function stabilizePaperAnalysisReport(markdown, { title, sources = [], sourceUrl = "" } = {}) {
  let report = String(markdown || "").trim() || `# ${title || "未命名论文"} · 论文解读`;
  for (const section of PAPER_ANALYSIS_SECTIONS) {
    if (!report.includes(`## ${section}`)) report += `\n\n## ${section}\n\n${fallback(section, sources, sourceUrl)}`;
  }
  return report.trim();
}

export function assessPaperAnalysisQuality(markdown, { document = {}, metadata = {}, sources = [], sourceUrl = "", warnings = [] } = {}) {
  const text = String(markdown || "");
  const present = PAPER_ANALYSIS_SECTIONS.filter((section) => text.includes(`## ${section}`)).length;
  const technical = ["技术问题", "方法架构", "核心算法或公式", "训练或推理流程", "实验设计与指标", "工程实现约束", "复现难点"];
  const technicalPresent = technical.filter((section) => text.includes(`### ${section}`)).length;
  const findings = [];
  let score = Math.round((present / PAPER_ANALYSIS_SECTIONS.length) * 25);
  score += Math.round((technicalPresent / technical.length) * 20);
  score += text.length >= 2600 ? 20 : text.length >= 1400 ? 12 : 5;
  score += String(document.text || "").length >= 1000 ? 20 : 5;
  score += metadata.title ? 5 : 0;
  score += sources.length || sourceUrl ? 10 : 0;
  if (present < PAPER_ANALYSIS_SECTIONS.length) findings.push(item("missing_sections", "fatal", "论文解读章节不完整"));
  if (technicalPresent < technical.length) findings.push(item("missing_technical_sections", "warn", "技术实现讲解缺少部分固定子栏目"));
  if (String(document.text || "").length < 1000) findings.push(item("paper_text_short", "fatal", "论文正文有效文本过短"));
  if (!metadata.title) findings.push(item("paper_title_missing", "warn", "未能稳定识别论文标题"));
  for (const warning of warnings.filter(Boolean)) findings.push(item("pipeline_warning", "warn", warning));
  return { ok: findings.every((entry) => entry.severity !== "fatal") && score >= 65, score: Math.max(0, Math.min(100, score)), components: { structure: present, technicalStructure: technicalPresent, sourceCount: sources.length }, metrics: { sourceCount: sources.length, paperCharacterCount: String(document.text || "").length, reportCharacterCount: text.length }, findings };
}

function fallback(section, sources, sourceUrl) {
  if (section === "参考来源") {
    const values = [...sources, ...(sourceUrl ? [{ title: "论文原文", url: sourceUrl }] : [])];
    return values.length ? values.map((item) => `- [${item.title}](${item.url})`).join("\n") : "本次未形成外部可引用来源。";
  }
  return "现有证据不足，需结合论文原文继续核验。";
}

function item(code, severity, message) { return { code, severity, message }; }
