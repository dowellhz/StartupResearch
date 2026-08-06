import { LANGUAGE_EN, getLanguage, t } from "./i18n.js";

function defaultPlaceholder() { return t("composer.companyPlaceholder", { zh: "公司名称（可选，可从 BP 识别）" }); }

export function enterUploadedBpCompanyContext(companyInput, currentReview) {
  if (!currentReview?.reportAvailable) return false;
  companyInput.value = "";
  companyInput.disabled = false;
  companyInput.placeholder = getLanguage() === LANGUAGE_EN ? "New company name (optional; can be identified from the new BP)" : "新公司名称（可选，可从新 BP 识别）";
  return true;
}

export function restoreCurrentCompanyContext(companyInput, currentReview) {
  companyInput.placeholder = defaultPlaceholder();
  if (!currentReview?.reportAvailable) return;
  companyInput.value = currentReview.companyName || "";
  companyInput.disabled = true;
}

export function setUploadAnalysisState({ filePreview, fileMeta, removeFile }, { active, matchingRequired = false } = {}) {
  filePreview.classList.toggle("is-analyzing", active);
  filePreview.setAttribute("aria-busy", String(active));
  removeFile.disabled = active;
  if (active) {
    filePreview.dataset.idleMeta = fileMeta.textContent;
    fileMeta.textContent = matchingRequired
      ? getLanguage() === LANGUAGE_EN ? "Parsing BP; AI is identifying the company and deciding whether to switch conversations…" : "正在解析 BP，AI 正在识别公司并判断是否切换对话…"
      : getLanguage() === LANGUAGE_EN ? "Uploading and parsing BP…" : "正在上传并解析 BP…";
  } else if (filePreview.dataset.idleMeta) {
    fileMeta.textContent = filePreview.dataset.idleMeta;
    delete filePreview.dataset.idleMeta;
  }
}
