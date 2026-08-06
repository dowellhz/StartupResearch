export const ATTACHMENT_SUBMISSION = "attachment";
export const COMPANY_RESEARCH_SUBMISSION = "company_research";
export const FOLLOWUP_SUBMISSION = "followup";
export const CANCEL_SUBMISSION = "cancel";
export const CONFIRM_COMPANY_RESEARCH_SUBMISSION = "confirm_company_research";
export const INDUSTRY_RESEARCH_SUBMISSION = "industry_research";
export const PAPER_ANALYSIS_SUBMISSION = "paper_analysis";

export function decideComposerSubmission({ taskType, hasCurrentReport, hasFile } = {}) {
  if (taskType === "company_pre_research") return COMPANY_RESEARCH_SUBMISSION;
  if (taskType === "industry_research") return INDUSTRY_RESEARCH_SUBMISSION;
  if (taskType === "paper_analysis") return PAPER_ANALYSIS_SUBMISSION;
  if (hasCurrentReport && !hasFile) return FOLLOWUP_SUBMISSION;
  if (hasFile) return ATTACHMENT_SUBMISSION;
  return CONFIRM_COMPANY_RESEARCH_SUBMISSION;
}
