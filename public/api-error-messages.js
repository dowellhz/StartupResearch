import { t } from "./i18n.js";

// 服务端错误消息是中文硬编码的，直接 toast 会让英文界面显示中文。
// 这里按稳定的 error code 做本地化；未收录的 code 原样沿用服务端文案，行为不变。
const MESSAGE_KEYS = {
  active_task_limit: "apiError.activeTaskLimit",
  cancel_in_progress: "apiError.cancelInProgress",
  cancel_not_allowed: "apiError.cancelNotAllowed",
  company_name_required: "apiError.companyNameRequired",
  company_research_disabled: "apiError.companyResearchDisabled",
  daily_budget_exceeded: "apiError.dailyBudgetExceeded",
  evidence_refresh_active: "apiError.evidenceRefreshActive",
  evidence_refresh_disabled: "apiError.evidenceRefreshDisabled",
  evidence_refresh_unsupported: "apiError.evidenceRefreshUnsupported",
  google_auth_required: "apiError.googleAuthRequired",
  industry_topic_required: "apiError.industryTopicRequired",
  invalid_json: "apiError.invalidJson",
  owner_required: "apiError.ownerRequired",
  paper_pdf_only: "apiError.paperPdfOnly",
  paper_source_required: "apiError.paperSourceRequired",
  payload_too_large: "apiError.payloadTooLarge",
  question_required: "apiError.questionRequired",
  rate_limit_exceeded: "apiError.rateLimitExceeded",
  replace_bp_unsupported: "apiError.replaceBpUnsupported",
  report_not_ready: "apiError.reportNotReady",
  retry_not_allowed: "apiError.retryNotAllowed",
  review_not_found: "apiError.reviewNotFound",
  single_upload_only: "apiError.singleUploadOnly",
  source_upload_missing: "apiError.sourceUploadMissing",
  task_already_running: "apiError.taskAlreadyRunning",
  task_queue_full: "apiError.taskQueueFull",
  task_type_disabled: "apiError.taskTypeDisabled",
  upload_count_exceeded: "apiError.uploadCountExceeded",
  upload_required: "apiError.uploadRequired",
  upload_too_large: "apiError.uploadTooLarge"
};

export function localizeApiError({ code, message } = {}) {
  const fallback = String(message || "").trim();
  const key = MESSAGE_KEYS[code];
  // 中文界面下 t() 直接返回 zh 分支，也就是服务端原文，措辞保持不变。
  if (key) return t(key, { zh: fallback || key });
  return fallback || t("apiError.generic", { zh: "请求失败，请稍后重试" });
}

export function apiErrorCodes() {
  return Object.keys(MESSAGE_KEYS);
}
