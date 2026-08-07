import { LANGUAGE_EN, getLanguage, t } from "./i18n.js";

function defaultPlaceholder() { return t("composer.companyPlaceholder", { zh: "公司名称（可选，可从 BP 识别）" }); }

export function shouldStartNewAttachmentConversation(currentReview) {
  return Boolean(currentReview?.reportAvailable);
}

export function restoreCurrentCompanyContext(companyInput, currentReview) {
  companyInput.placeholder = defaultPlaceholder();
  if (!currentReview?.reportAvailable) return;
  companyInput.value = currentReview.companyName || "";
  companyInput.disabled = true;
}

export function setUploadAnalysisState({ filePreview, fileMeta, removeFile }, { active } = {}) {
  filePreview.classList.toggle("is-analyzing", active);
  filePreview.setAttribute("aria-busy", String(active));
  removeFile.disabled = active;
  if (active) {
    filePreview.dataset.idleMeta = fileMeta.textContent;
    fileMeta.textContent = getLanguage() === LANGUAGE_EN
      ? "Uploading and parsing BP in a new conversation…"
      : "正在新对话中上传并解析 BP…";
  } else if (filePreview.dataset.idleMeta) {
    fileMeta.textContent = filePreview.dataset.idleMeta;
    delete filePreview.dataset.idleMeta;
  }
}
