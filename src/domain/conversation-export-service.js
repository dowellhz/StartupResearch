import { normalizeReviewReport } from "./report-summary-service.js";

export function buildConversationExport(review) {
  const taskType = review?.taskType === "company_pre_research" ? "company_pre_research" : "attachment_review";
  const companyName = String(review?.companyName || "未命名公司").trim();
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
    reportLabel: taskType === "company_pre_research" ? "公司预研报告" : "BP 核查报告",
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
  return taskType === "company_pre_research" ? "基于公开信息完成公司预研" : "全面核查这份 BP";
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
