export const ATTACHMENT_REVIEW = "attachment_review";
export const COMPANY_PRE_RESEARCH = "company_pre_research";

export function createComposerTaskModeController({ elements, state, clearAttachment = () => {} }) {
  function bind() {
    elements.attachButton.addEventListener("click", toggleMenu);
    elements.attachmentOption.addEventListener("click", () => {
      selectAttachmentMode();
      closeMenu();
      elements.fileInput.click();
    });
    elements.companyResearchOption.addEventListener("click", () => {
      clearAttachment();
      selectCompanyResearchMode();
      closeMenu();
      elements.companyInput.focus();
    });
    elements.exitResearchMode.addEventListener("click", selectAttachmentMode);
    document.addEventListener("click", (event) => {
      if (!elements.addMenu.contains(event.target) && !elements.attachButton.contains(event.target)) closeMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
  }

  function selectAttachmentMode() {
    state.taskType = taskTypeForFileInput();
    elements.researchPreview.classList.add("hidden");
    elements.companyInput.placeholder = "公司名称（可选，可从材料识别）";
    elements.promptInput.placeholder = state.currentReview?.reportAvailable
      ? "继续追问，或通过 + 上传新材料…"
      : "补充核查要求，或在报告完成后继续追问…";
    elements.composerNote.textContent = "点击 + 添加附件或发起公司预研，也可把材料拖入输入框 · AI 结论仅供投资研究参考";
  }

  function selectCompanyResearchMode() {
    state.taskType = COMPANY_PRE_RESEARCH;
    elements.researchPreview.classList.remove("hidden");
    elements.companyInput.disabled = false;
    elements.companyInput.placeholder = "公司名称（公司预研必填）";
    elements.promptInput.placeholder = "补充预研关注方向（可选）";
    elements.composerNote.textContent = "公司预研模式：输入公司名称即可抓取公开信息，无需上传附件";
  }

  function toggleMenu() {
    const opening = elements.addMenu.classList.contains("hidden");
    elements.addMenu.classList.toggle("hidden", !opening);
    elements.attachButton.setAttribute("aria-expanded", String(opening));
  }

  function closeMenu() {
    elements.addMenu.classList.add("hidden");
    elements.attachButton.setAttribute("aria-expanded", "false");
  }

  return { bind, closeMenu, selectAttachmentMode, selectCompanyResearchMode };
}

export function taskTypeForFileInput() {
  return ATTACHMENT_REVIEW;
}
