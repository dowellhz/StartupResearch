import { escapeHtml } from "./markdown-renderer.js";
import { sanitizeVisibleFilename } from "./privacy-redaction.js";
import { LANGUAGE_EN, getLanguage, t } from "./i18n.js";

export function renderReviewRequest(container, { company, prompt, file, taskType }) {
  const isResearch = taskType === "company_pre_research";
  const isIndustry = taskType === "industry_research";
  const isTechnology = taskType === "technology_research";
  const isPaper = taskType === "paper_analysis";
  const name = sanitizeVisibleFilename(file?.name || file?.filename || "附件");
  const size = file?.size ? ` · ${formatBytes(file.size)}` : "";
  const identity = company || (getLanguage() === LANGUAGE_EN ? (isResearch ? "Company to research" : isIndustry ? "Industry to research" : isTechnology ? "Technology to research" : isPaper ? "Paper title pending" : "Company identified from material") : (isResearch ? "待研究公司" : isIndustry ? "待研究行业" : isTechnology ? "待调研技术" : isPaper ? "待识别论文" : "由材料自动识别公司"));
  const artifact = isResearch
    ? `<div class="file-inline research-inline"><b>研</b><span>${getLanguage() === LANGUAGE_EN ? "Company Research · Public information" : "公司预研 · 公开信息"}</span></div>`
    : isIndustry
      ? `<div class="file-inline research-inline"><b>行</b><span>${getLanguage() === LANGUAGE_EN ? "Industry Research · Public sources and papers" : "行业研究 · 公开资料与论文"}</span></div>`
      : isTechnology
        ? `<div class="file-inline research-inline"><b>技</b><span>${getLanguage() === LANGUAGE_EN ? "Technology Research · Papers, routes and maturity" : "技术调研 · 论文、路线与成熟度"}</span></div>`
      : isPaper
        ? `<div class="file-inline research-inline"><b>论</b><span>${getLanguage() === LANGUAGE_EN ? "Paper Analysis" : "论文解读"}${file ? ` · ${escapeHtml(name)}${size}` : getLanguage() === LANGUAGE_EN ? " · Public paper URL" : " · 公开论文 URL"}</span></div>`
        : `<div class="file-inline"><b>附</b><span>${escapeHtml(name)}${size}</span></div>`;
  container.insertAdjacentHTML("beforeend", `
    <article class="message user">
      <div class="message-meta"><span class="avatar">${t("message.you", { zh: "你" })}</span>${t("message.request", { zh: "你的请求" })}</div>
      <div class="message-body"><strong class="request-company">${escapeHtml(identity)}</strong><br>${escapeHtml(prompt)}${artifact}</div>
    </article>`);
}

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function stageStatusCopy(status) {
  if (getLanguage() === LANGUAGE_EN) return ({ pending: "Waiting", running: "Processing", completed: "Completed", restored: "Restored", failed: "Failed" })[status] || "";
  return ({ pending: "等待前序步骤", running: "正在处理", completed: "已完成", restored: "已恢复", failed: "执行失败" })[status] || "";
}
