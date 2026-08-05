export const ATTACHMENT_SUBMISSION = "attachment";
export const COMPANY_RESEARCH_SUBMISSION = "company_research";
export const FOLLOWUP_SUBMISSION = "followup";
export const CANCEL_SUBMISSION = "cancel";

export const NO_ATTACHMENT_CONFIRMATION = "未上传附件。是否不传附件，直接抓取公开信息进行公司预研？";

export function decideComposerSubmission({ taskType, hasCurrentReport, hasFile, confirmImpl = globalThis.confirm } = {}) {
  if (taskType === "company_pre_research") return COMPANY_RESEARCH_SUBMISSION;
  if (hasCurrentReport && !hasFile) return FOLLOWUP_SUBMISSION;
  if (hasFile) return ATTACHMENT_SUBMISSION;
  return typeof confirmImpl === "function" && confirmImpl(NO_ATTACHMENT_CONFIRMATION)
    ? COMPANY_RESEARCH_SUBMISSION
    : CANCEL_SUBMISSION;
}
