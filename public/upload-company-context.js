const DEFAULT_PLACEHOLDER = "公司名称（可选，可从 BP 识别）";

export function enterUploadedBpCompanyContext(companyInput, currentReview) {
  if (!currentReview?.reportAvailable) return false;
  companyInput.value = "";
  companyInput.disabled = false;
  companyInput.placeholder = "新公司名称（可选，可从新 BP 识别）";
  return true;
}

export function restoreCurrentCompanyContext(companyInput, currentReview) {
  companyInput.placeholder = DEFAULT_PLACEHOLDER;
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
      ? "正在解析 BP，AI 正在识别公司并判断是否切换对话…"
      : "正在上传并解析 BP…";
  } else if (filePreview.dataset.idleMeta) {
    fileMeta.textContent = filePreview.dataset.idleMeta;
    delete filePreview.dataset.idleMeta;
  }
}
