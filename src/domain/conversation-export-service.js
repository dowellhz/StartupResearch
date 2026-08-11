import { normalizeReviewReport } from "./report-summary-service.js";

export function buildConversationExport(review) {
  const taskType = ["company_pre_research", "industry_research", "technology_research", "paper_analysis"].includes(review?.taskType) ? review.taskType : "attachment_review";
  const companyName = String(review?.companyName || "未命名主题").trim();
  return {
    title: `${companyName} · 完整对话`,
    companyName,
    taskType,
    status: String(review?.status || ""),
    createdAt: review?.createdAt || "",
    updatedAt: review?.updatedAt || "",
    request: {
      instruction: String(review?.instruction || defaultInstruction(taskType)).trim(),
      attachment: review?.upload ? {
        filename: String(review.upload.filename || "附件"),
        size: Number(review.upload.size || 0)
      } : null
    },
    stages: array(review?.stages).map((stage) => ({
      label: String(stage?.label || ""),
      status: String(stage?.status || ""),
      message: String(stage?.message || "")
    })),
    report: normalizeReviewReport(review),
    reportLabel: reportLabel(taskType, review?.outputLanguage),
    quality: review?.quality || null,
    evidenceRefresh: review?.lastEvidenceRefresh?.report ? {
      title: "公开资料刷新",
      report: String(review.lastEvidenceRefresh.report),
      completedAt: review.lastEvidenceRefresh.completedAt || ""
    } : null,
    messages: array(review?.messages).filter((message) => ["user", "assistant"].includes(message?.role)).map((message) => ({
      role: message.role,
      content: String(message.content || ""),
      at: message.at || ""
    }))
  };
}

function defaultInstruction(taskType) {
  return ({ company_pre_research: "基于公开信息完成公司预研", industry_research: "完成行业概览研究", technology_research: "完成技术调研", paper_analysis: "解读论文的技术、可信度与商业化价值" })[taskType] || "全面核查这份 BP";
}

function reportLabel(taskType, outputLanguage) {
  if (outputLanguage === "en") return ({ company_pre_research: "Company Research Report", industry_research: "Industry Research Report", technology_research: "Technology Research Report", paper_analysis: "Paper Analysis Report" })[taskType] || "BP Review Report";
  return ({ company_pre_research: "公司预研报告", industry_research: "行业研究报告", technology_research: "技术调研报告", paper_analysis: "论文解读报告" })[taskType] || "BP 核查报告";
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
