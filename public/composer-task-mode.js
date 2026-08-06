import { renderEmptyStateMode } from "./empty-state-mode.js";
import { t } from "./i18n.js";

export const ATTACHMENT_REVIEW = "attachment_review";
export const COMPANY_PRE_RESEARCH = "company_pre_research";
export const INDUSTRY_RESEARCH = "industry_research";
export const PAPER_ANALYSIS = "paper_analysis";

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
    elements.paperUploadButton.addEventListener("click", () => {
      elements.fileInput.accept = ".pdf,application/pdf";
      elements.fileInput.click();
    });
    elements.exitResearchMode.addEventListener("click", selectAttachmentMode);
    elements.exitIndustryResearchMode.addEventListener("click", selectAttachmentMode);
    elements.exitPaperAnalysisMode.addEventListener("click", selectAttachmentMode);
    document.addEventListener("click", (event) => {
      if (!elements.addMenu.contains(event.target) && !elements.attachButton.contains(event.target)) closeMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
  }

  function selectAttachmentMode() {
    state.taskType = taskTypeForFileInput();
    hideSpecialPreviews();
    renderEmptyStateMode(elements, ATTACHMENT_REVIEW);
    setNewTaskTitle(t("top.newBp", { zh: "新建 BP 核查" }));
    elements.fileInput.accept = ".pdf,.pptx,.docx,.txt,.md,application/pdf";
    elements.companyInput.placeholder = t("composer.companyPlaceholder", { zh: "公司名称（可选，可从材料识别）" });
    elements.promptInput.placeholder = state.currentReview?.reportAvailable
      ? t("composer.followupPlaceholder", { zh: "继续追问，或通过 + 上传新材料…" })
      : t("composer.promptPlaceholder", { zh: "补充核查要求，或在报告完成后继续追问…" });
    elements.composerNote.textContent = t("composer.note", { zh: "点击 + 添加附件或发起公司预研，也可把材料拖入输入框 · AI 结论仅供投资研究参考" });
  }

  function selectCompanyResearchMode() {
    state.taskType = COMPANY_PRE_RESEARCH;
    hideSpecialPreviews();
    renderEmptyStateMode(elements, COMPANY_PRE_RESEARCH);
    setNewTaskTitle(t("top.newCompany", { zh: "新建公司预研" }));
    elements.researchPreview.classList.remove("hidden");
    elements.companyInput.disabled = false;
    elements.companyInput.placeholder = t("composer.companyRequired", { zh: "公司名称（公司预研必填）" });
    elements.promptInput.placeholder = t("composer.companyFocus", { zh: "补充预研关注方向（可选）" });
    elements.composerNote.textContent = t("composer.companyNote", { zh: "公司预研模式：输入公司名称即可抓取公开信息，无需上传附件" });
  }

  function selectIndustryResearchMode() {
    clearAttachment();
    state.taskType = INDUSTRY_RESEARCH;
    hideSpecialPreviews();
    renderEmptyStateMode(elements, INDUSTRY_RESEARCH);
    setNewTaskTitle(t("top.newIndustry", { zh: "新建行业研究" }));
    elements.industryResearchPreview.classList.remove("hidden");
    elements.companyInput.disabled = false;
    elements.companyInput.placeholder = t("composer.industryRequired", { zh: "行业或技术主题（必填）" });
    elements.promptInput.placeholder = t("composer.industryFocus", { zh: "补充研究范围、地区、时间或投资关注点（可选）" });
    elements.composerNote.textContent = t("composer.industryNote", { zh: "行业研究模式：系统会规划问题并检索公开网页、论文与专项数据库" });
  }

  function selectPaperAnalysisMode() {
    state.taskType = PAPER_ANALYSIS;
    hideSpecialPreviews();
    renderEmptyStateMode(elements, PAPER_ANALYSIS);
    setNewTaskTitle(t("top.newPaper", { zh: "新建论文解读" }));
    elements.paperAnalysisPreview.classList.remove("hidden");
    elements.fileInput.accept = ".pdf,application/pdf";
    elements.companyInput.disabled = false;
    elements.companyInput.placeholder = t("composer.paperTitle", { zh: "论文标题（可选，可从 PDF 识别）" });
    elements.promptInput.placeholder = t("composer.paperFocus", { zh: "补充关注角度（技术、复现、产业化等）" });
    elements.composerNote.textContent = t("composer.paperNote", { zh: "论文解读模式：上传 PDF 或填写公开论文 URL，系统将补充学术检索" });
  }

  function hideSpecialPreviews() {
    elements.researchPreview.classList.add("hidden");
    elements.industryResearchPreview.classList.add("hidden");
    elements.paperAnalysisPreview.classList.add("hidden");
  }

  function setNewTaskTitle(value) {
    if (!state.currentId && elements.conversationTitle) elements.conversationTitle.textContent = value;
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

  return { bind, closeMenu, selectAttachmentMode, selectCompanyResearchMode, selectIndustryResearchMode, selectPaperAnalysisMode };
}

export function taskTypeForFileInput(currentTaskType) {
  if (currentTaskType === PAPER_ANALYSIS) return PAPER_ANALYSIS;
  return ATTACHMENT_REVIEW;
}
