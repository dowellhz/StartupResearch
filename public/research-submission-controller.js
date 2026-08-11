import { fileToBase64, submitCompanyPreResearch, submitIndustryResearch, submitPaperAnalysis } from "./review-submit.js";
import { renderReviewRequest } from "./review-request-message.js";
import { COMPANY_PRE_RESEARCH, INDUSTRY_RESEARCH, PAPER_ANALYSIS } from "./composer-task-mode.js";
import { getLanguage, t } from "./i18n.js";
import { localizedReviewTitle } from "./task-type-labels.js";

export function createResearchSubmissionController(deps) {
  const { elements, state, taskMode, requestJson, draft, setBusy, notify, showConversation, renderProgressPanel, focusResearchStart = () => {}, connectEvents, loadHistory, clearFile } = deps;

  async function start(taskType, prompt) {
    const subject = elements.companyInput.value.trim();
    const sourceUrl = elements.paperUrlInput.value.trim();
    const validation = validateInput({ taskType, subject, sourceUrl, file: state.file });
    if (validation) return notify(validation);
    setBusy(true);
    try {
      const instruction = prompt || defaultInstruction(taskType);
      const payload = await submit(taskType, { subject, sourceUrl, instruction });
      Object.assign(state, { currentId: payload.review.id, currentReview: payload.review, stages: payload.review.stages || [], report: "" });
      showConversation();
      elements.messageStream.innerHTML = "";
      renderReviewRequest(elements.messageStream, { company: subject || payload.review.companyName, prompt: instruction, file: state.file, taskType });
      state.autoFollow = false;
      renderProgressPanel();
      focusResearchStart();
      elements.conversationTitle.textContent = localizedReviewTitle(payload.review);
      draft.clearCompany();
      draft.clearPrompt();
      if (state.file) clearFile();
      elements.paperUrlInput.value = "";
      elements.companyInput.value = payload.review.companyName || subject;
      taskMode.selectAttachmentMode();
      connectEvents(state.currentId);
      await loadHistory();
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(taskType, { subject, sourceUrl, instruction }) {
    const outputLanguage = getLanguage();
    if (taskType === COMPANY_PRE_RESEARCH) return submitCompanyPreResearch({ requestJson, companyName: subject, instruction, outputLanguage });
    if (taskType === INDUSTRY_RESEARCH) return submitIndustryResearch({ requestJson, topic: subject, instruction, researchTemplate: elements.industryResearchTemplate.value, outputLanguage });
    const data = state.file ? await fileToBase64(state.file) : "";
    return submitPaperAnalysis({ requestJson, title: subject, instruction, sourceUrl, outputLanguage, file: state.file, data });
  }

  return { start };
}

export function validateInput({ taskType, subject, sourceUrl, file }) {
  if (taskType === COMPANY_PRE_RESEARCH && !subject) return t("validation.company", { zh: "公司预研需要填写公司名称" });
  if (taskType === INDUSTRY_RESEARCH && !subject) return t("validation.industry", { zh: "行业研究需要填写行业或技术主题" });
  if (taskType === PAPER_ANALYSIS && !file && !/^https?:\/\//i.test(sourceUrl)) return t("validation.paperSource", { zh: "论文解读需要上传 PDF 或填写论文 URL" });
  if (taskType === PAPER_ANALYSIS && file && !/\.pdf$/i.test(file.name || "") && !/application\/pdf/i.test(file.type || "")) return t("validation.paperPdf", { zh: "论文解读仅支持 PDF 文件" });
  return "";
}

function defaultInstruction(taskType) {
  return ({
    company_pre_research: t("instruction.company", { zh: "基于公开信息完成公司预研" }),
    industry_research: t("instruction.industry", { zh: "完成行业概览研究" }),
    paper_analysis: t("instruction.paper", { zh: "从技术、可信度、行业价值和商业化角度解读论文" })
  })[taskType] || "完成研究";
}
