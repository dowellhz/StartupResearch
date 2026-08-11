import { LANGUAGE_EN, getLanguage, t } from "./i18n.js";

const LABELS = Object.freeze({
  attachment_review: ["attachment", "bp", "review", "review", "BP REVIEW REPORT"],
  company_pre_research: ["company", "company", "company", "company", "COMPANY RESEARCH REPORT"],
  industry_research: ["industry", "industry", "industry", "industry", "INDUSTRY RESEARCH REPORT"],
  technology_research: ["technology", "technology", "technology", "technology", "TECHNOLOGY RESEARCH REPORT"],
  paper_analysis: ["paper", "paper", "paper", "paper", "PAPER ANALYSIS REPORT"]
});

const ZH = Object.freeze({
  attachment_review: ["附件核查", "BP 核查报告", "核查结果", "重新核查"],
  company_pre_research: ["公司预研", "公司预研报告", "公司预研结果", "重新预研"],
  industry_research: ["行业研究", "行业研究报告", "行业研究结果", "重新研究"],
  technology_research: ["技术调研", "技术调研报告", "技术调研结果", "重新调研"],
  paper_analysis: ["论文解读", "论文解读报告", "论文解读结果", "重新解读"]
});

export function taskTypeLabels(taskType) {
  const key = LABELS[taskType] ? taskType : "attachment_review";
  const [taskKey, reportKey, resultKey, rerunKey, eyebrow] = LABELS[key];
  const zh = ZH[key];
  return { task: t(`task.${taskKey}`, { zh: zh[0] }), report: t(`report.${reportKey}`, { zh: zh[1] }), result: t(`result.${resultKey}`, { zh: zh[2] }), eyebrow, rerun: t(`rerun.${rerunKey}`, { zh: zh[3] }) };
}

export function supportsEvidenceRefresh(taskType) {
  return !["industry_research", "technology_research", "paper_analysis"].includes(taskType);
}

export function localizedReviewTitle(review) {
  if (getLanguage() !== LANGUAGE_EN) return review?.title || review?.companyName || "";
  const subject = review?.companyName || "Untitled";
  return `${subject} · ${taskTypeLabels(review?.taskType).task}`;
}
