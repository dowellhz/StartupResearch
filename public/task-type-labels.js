const LABELS = Object.freeze({
  attachment_review: { task: "附件核查", report: "BP 核查报告", result: "核查结果", eyebrow: "BP REVIEW REPORT", rerun: "重新核查" },
  company_pre_research: { task: "公司预研", report: "公司预研报告", result: "公司预研结果", eyebrow: "COMPANY RESEARCH REPORT", rerun: "重新预研" },
  industry_research: { task: "行业研究", report: "行业研究报告", result: "行业研究结果", eyebrow: "INDUSTRY RESEARCH REPORT", rerun: "重新研究" },
  paper_analysis: { task: "论文解读", report: "论文解读报告", result: "论文解读结果", eyebrow: "PAPER ANALYSIS REPORT", rerun: "重新解读" }
});

export function taskTypeLabels(taskType) {
  return LABELS[taskType] || LABELS.attachment_review;
}

export function supportsEvidenceRefresh(taskType) {
  return !["industry_research", "paper_analysis"].includes(taskType);
}
