import { escapeHtml, markdownToHtml } from "./markdown-renderer.js";
import { bindComposerInput } from "./composer-keyboard.js";
import { createComposerDraftController, lastUserInput } from "./composer-draft.js";
import { ATTACHMENT_SUBMISSION, CANCEL_SUBMISSION, COMPANY_RESEARCH_SUBMISSION, CONFIRM_COMPANY_RESEARCH_SUBMISSION, decideComposerSubmission, FOLLOWUP_SUBMISSION, INDUSTRY_RESEARCH_SUBMISSION, PAPER_ANALYSIS_SUBMISSION } from "./composer-submit-route.js";
import { ATTACHMENT_REVIEW, COMPANY_PRE_RESEARCH, INDUSTRY_RESEARCH, PAPER_ANALYSIS, createComposerTaskModeController, taskTypeForFileInput } from "./composer-task-mode.js";
import { createConfirmationDialogController } from "./confirmation-dialog.js";
import { bindFileDrop } from "./file-drop.js";
import { createEvidenceRefreshController, isEvidenceRefreshActive } from "./evidence-refresh-ui.js";
import { renderFollowupSuggestions } from "./followup-suggestions.js";
import { renderHistoryList } from "./history-list.js";
import { refreshHealthStatus } from "./health-status.js";
import { applyDocumentTranslations, bindLanguageToggle, getLanguage, t } from "./i18n.js";
import { requestJson, requestResponse } from "./http-client.js";
import { downloadConversationPdf, downloadReviewPdf, syncConversationPdfButton } from "./pdf-download.js";
import { applyDetectedCompany } from "./review-identity.js";
import { applyRecoverableReport } from "./review-error.js";
import { applyUploadRouting, fileToBase64, submitUploadedBp } from "./review-submit.js";
import { formatBytes, renderReviewRequest } from "./review-request-message.js";
import { enterUploadedBpCompanyContext, restoreCurrentCompanyContext, setUploadAnalysisState } from "./upload-company-context.js";
import { sanitizeVisibleFilename } from "./privacy-redaction.js";
import { progressStageCopy } from "./progress-stage-copy.js";
import { renderQualitySummary } from "./quality-summary.js";
import { createReanalyzeController } from "./reanalyze-controller.js";
import { createResearchSubmissionController } from "./research-submission-controller.js";
import { focusResearchStart } from "./research-view-focus.js";
import { runFollowup } from "./followup-controller.js";
import { renderStreamingMarkdown, STREAM_RENDER_INTERVAL } from "./streaming-markdown.js";
import { localizedReviewTitle, supportsEvidenceRefresh, taskTypeLabels } from "./task-type-labels.js";
const elements = {
  addMenu: document.querySelector("#addMenu"),
  attachButton: document.querySelector("#attachButton"),
  attachmentOption: document.querySelector("#attachmentOption"),
  closeHelp: document.querySelector("#closeHelp"),
  companyInput: document.querySelector("#companyInput"),
  companyResearchOption: document.querySelector("#companyResearchOption"),
  composer: document.querySelector("#composer"),
  composerNote: document.querySelector("#composerNote"),
  conversation: document.querySelector("#conversation"),
  conversationPdfButton: document.querySelector("#conversationPdfButton"),
  conversationTitle: document.querySelector("#conversationTitle"),
  emptyState: document.querySelector("#emptyState"),
  emptyCopy: document.querySelector("#emptyCopy"),
  emptyEyebrow: document.querySelector("#emptyEyebrow"),
  emptyHeading: document.querySelector("#emptyHeading"),
  emptySuggestions: document.querySelector("#emptySuggestions"),
  fileInput: document.querySelector("#fileInput"),
  fileMeta: document.querySelector("#fileMeta"),
  fileName: document.querySelector("#fileName"),
  filePreview: document.querySelector("#filePreview"),
  exitResearchMode: document.querySelector("#exitResearchMode"),
  exitIndustryResearchMode: document.querySelector("#exitIndustryResearchMode"),
  exitPaperAnalysisMode: document.querySelector("#exitPaperAnalysisMode"),
  helpButton: document.querySelector("#helpButton"),
  helpDialog: document.querySelector("#helpDialog"),
  historyList: document.querySelector("#historyList"),
  industryResearchPreview: document.querySelector("#industryResearchPreview"),
  industryResearchTemplate: document.querySelector("#industryResearchTemplate"),
  languageToggle: document.querySelector("#languageToggle"),
  menuButton: document.querySelector("#menuButton"),
  messageStream: document.querySelector("#messageStream"),
  modelDot: document.querySelector("#modelDot"),
  modelText: document.querySelector("#modelText"),
  newReviewButton: document.querySelector("#newReviewButton"),
  newIndustryResearchButton: document.querySelector("#newIndustryResearchButton"),
  newPaperAnalysisButton: document.querySelector("#newPaperAnalysisButton"),
  noAttachmentDialog: document.querySelector("#noAttachmentDialog"),
  paperAnalysisPreview: document.querySelector("#paperAnalysisPreview"),
  paperUploadButton: document.querySelector("#paperUploadButton"),
  paperUrlInput: document.querySelector("#paperUrlInput"),
  promptInput: document.querySelector("#promptInput"),
  removeFile: document.querySelector("#removeFile"),
  researchPreview: document.querySelector("#researchPreview"),
  sendButton: document.querySelector("#sendButton"),
  sidebar: document.querySelector("#sidebar"),
  toastRegion: document.querySelector("#toastRegion")
};
const draft = createComposerDraftController({
  companyInput: elements.companyInput,
  promptInput: elements.promptInput,
  onRestore: autoResize
});
const state = {
  currentId: "",
  currentReview: null,
  eventSource: null,
  file: null,
  report: "",
  reportRenderTimer: null,
  stages: [],
  autoFollow: true,
  taskType: ATTACHMENT_REVIEW
};
const taskMode = createComposerTaskModeController({ elements, state, clearAttachment: clearFile });
const noAttachmentConfirmation = createConfirmationDialogController({ dialog: elements.noAttachmentDialog });
const evidenceRefreshController = createEvidenceRefreshController({ state, container: elements.messageStream, requestJson,
  connectEvents, notify: toast, scrollBottom, refreshHistory: loadHistory });
const researchSubmission = createResearchSubmissionController({ elements, state, taskMode, requestJson, draft, setBusy, notify: toast,
  showConversation, renderProgressPanel, focusCurrentResearchStart, connectEvents, loadHistory, clearFile });
const reanalyzeCurrentReview = createReanalyzeController({ state, requestJson, renderProgress: renderProgressPanel, connectEvents,
  focusResearchStart: focusCurrentResearchStart, notify: toast, labelFor: taskTypeLabels, confirmImpl: window.confirm.bind(window), disableButton: () => document.querySelector("[data-reanalyze]")?.setAttribute("disabled", "") });
boot();

async function boot() {
  applyDocumentTranslations();
  taskMode.selectAttachmentMode();
  bindEvents();
  draft.restore();
  await Promise.all([refreshHealthStatus({ requestJson, modelDot: elements.modelDot, modelText: elements.modelText }), loadHistory()]);
}
function bindEvents() {
  taskMode.bind();
  bindLanguageToggle({ button: elements.languageToggle });
  elements.fileInput.addEventListener("change", () => selectFile(elements.fileInput.files[0]));
  bindFileDrop({ dropZone: elements.composer, onFile: selectFile, onMultiple: () => toast(t("validation.oneFile", { zh: "一次只能上传一份 BP，已选择第一个文件" })) });
  elements.removeFile.addEventListener("click", clearFile);
  elements.composer.addEventListener("submit", submitComposer);
  elements.conversationPdfButton.addEventListener("click", () => downloadConversationPdf(state.currentId));
  elements.newReviewButton.addEventListener("click", resetWorkspace);
  elements.newIndustryResearchButton.addEventListener("click", () => { resetWorkspace(); taskMode.selectIndustryResearchMode(); elements.companyInput.focus(); });
  elements.newPaperAnalysisButton.addEventListener("click", () => { resetWorkspace(); taskMode.selectPaperAnalysisMode(); elements.paperUrlInput.focus(); });
  elements.helpButton.addEventListener("click", () => elements.helpDialog.showModal());
  elements.closeHelp.addEventListener("click", () => elements.helpDialog.close());
  elements.menuButton.addEventListener("click", () => elements.sidebar.classList.toggle("open"));
  elements.companyInput.addEventListener("input", draft.saveCompany);
  bindComposerInput({ textarea: elements.promptInput, form: elements.composer, submitButton: elements.sendButton, onInput: () => { autoResize(); draft.save(); } });
  elements.conversation.addEventListener("scroll", () => {
    state.autoFollow = isNearConversationBottom();
  }, { passive: true });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      resetWorkspace();
    }
  });
  document.querySelectorAll("[data-suggestion]").forEach((button) => button.addEventListener("click", () => {
    elements.promptInput.value = button.dataset.suggestion;
    draft.save();
    elements.companyInput.focus();
  }));
}
async function loadHistory() {
  try {
    const payload = await requestJson("/api/reviews");
    renderHistory(payload.reviews || []);
  } catch (error) {
    toast(error.message);
  }
}
function renderHistory(reviews) {
  renderHistoryList({ container: elements.historyList, reviews, currentId: state.currentId, requestJson,
    onOpen: loadReview, onCurrentDeleted: resetWorkspace, refresh: loadHistory, notify: toast });
}
function selectFile(file) {
  if (!file) return;
  const allowed = ["pdf", "pptx", "docx", "txt", "md", "markdown"];
  const extension = file.name.split(".").pop().toLowerCase();
  const fileTaskType = taskTypeForFileInput(state.taskType);
  if (fileTaskType === PAPER_ANALYSIS && extension !== "pdf") return toast(t("validation.paperPdf", { zh: "论文解读仅支持 PDF 文件" }));
  if (!allowed.includes(extension)) return toast(t("validation.fileTypes", { zh: "请上传 PDF、PPTX、DOCX、TXT 或 Markdown" }));
  if (file.size > 20 * 1024 * 1024) return toast(t("validation.fileSize", { zh: "文件不能超过 20 MB" }));
  if (fileTaskType === PAPER_ANALYSIS) taskMode.selectPaperAnalysisMode();
  else taskMode.selectAttachmentMode();
  state.file = file;
  const attachmentReview = fileTaskType === PAPER_ANALYSIS || state.currentReview?.taskType !== ATTACHMENT_REVIEW ? null : state.currentReview;
  const matchingRequired = enterUploadedBpCompanyContext(elements.companyInput, attachmentReview);
  elements.fileName.textContent = sanitizeVisibleFilename(file.name);
  elements.fileMeta.textContent = `${formatBytes(file.size)} · ${fileTaskType === PAPER_ANALYSIS ? t("file.paperPending", { zh: "等待论文解读" }) : matchingRequired ? t("file.companyPending", { zh: "提交后识别公司并判断是否新建对话" }) : t("file.reviewPending", { zh: "等待核查" })}`;
  elements.filePreview.classList.remove("hidden");
}
function clearFile() {
  setUploadAnalysisState(elements, { active: false });
  state.file = null;
  elements.fileInput.value = "";
  elements.filePreview.classList.add("hidden");
  restoreCurrentCompanyContext(elements.companyInput, state.currentReview);
}
async function submitComposer(event) {
  event.preventDefault();
  const prompt = elements.promptInput.value.trim();
  let submission = decideComposerSubmission({
    taskType: state.taskType,
    hasCurrentReport: Boolean(state.currentReview?.reportAvailable),
    hasFile: Boolean(state.file)
  });
  if (submission === CONFIRM_COMPANY_RESEARCH_SUBMISSION) {
    const confirmed = await noAttachmentConfirmation.request();
    submission = confirmed ? COMPANY_RESEARCH_SUBMISSION : CANCEL_SUBMISSION;
  }
  if (submission === CANCEL_SUBMISSION) return;
  if (submission === FOLLOWUP_SUBMISSION) return askFollowup(prompt);
  if (submission === COMPANY_RESEARCH_SUBMISSION) {
    taskMode.selectCompanyResearchMode();
    return startCompanyPreResearch(prompt);
  }
  if (submission === INDUSTRY_RESEARCH_SUBMISSION) return researchSubmission.start(INDUSTRY_RESEARCH, prompt);
  if (submission === PAPER_ANALYSIS_SUBMISSION) return researchSubmission.start(PAPER_ANALYSIS, prompt);
  if (submission !== ATTACHMENT_SUBMISSION) return;
  const companyName = elements.companyInput.value.trim();
  setUploadAnalysisState(elements, { active: true, matchingRequired: Boolean(state.currentReview?.reportAvailable) });
  setBusy(true);
  try {
    const data = await fileToBase64(state.file);
    const file = state.file;
    const payload = await submitUploadedBp({
      requestJson,
      currentId: state.currentId,
      currentReview: state.currentReview,
      companyName,
      instruction: prompt || t("instruction.bp", { zh: "全面核查这份 BP" }),
      outputLanguage: getLanguage(),
      file,
      data
    });
    applyUploadRouting(payload, { elements, state, notify: toast });
    state.currentId = payload.review.id;
    state.currentReview = payload.review;
    state.stages = payload.review.stages || [];
    state.report = "";
    elements.companyInput.value = payload.review.companyName || payload.decision?.newCompanyName || "";
    elements.companyInput.disabled = false;
    showConversation();
    renderReviewRequest(elements.messageStream, { company: payload.review.companyName || payload.decision?.newCompanyName || companyName, prompt: prompt || t("instruction.material", { zh: "全面核查这份材料" }), file, taskType: ATTACHMENT_REVIEW });
    draft.clearCompany();
    draft.clearPrompt();
    state.autoFollow = false;
    renderProgressPanel();
    focusCurrentResearchStart();
    elements.conversationTitle.textContent = localizedReviewTitle(payload.review);
    draft.save();
    clearFile();
    connectEvents(state.currentId);
    await loadHistory();
  } catch (error) {
    toast(error.message);
  } finally {
    if (state.file) setUploadAnalysisState(elements, { active: false });
    setBusy(false);
  }
}

async function startCompanyPreResearch(prompt) {
  return researchSubmission.start(COMPANY_PRE_RESEARCH, prompt);
}
function connectEvents(id) {
  state.eventSource?.close();
  const source = new EventSource(`/api/reviews/${id}/events`);
  state.eventSource = source;
  source.addEventListener("snapshot", ({ data }) => applySnapshot(JSON.parse(data)));
  source.addEventListener("stage", ({ data }) => applyStage(JSON.parse(data)));
  source.addEventListener("report_delta", ({ data }) => applyReportDelta(JSON.parse(data).delta));
  source.addEventListener("report_complete", ({ data }) => completeReport(JSON.parse(data)));
  source.addEventListener("refresh_snapshot", ({ data }) => evidenceRefreshController.apply(JSON.parse(data)));
  source.addEventListener("refresh_stage", ({ data }) => evidenceRefreshController.apply(JSON.parse(data)));
  source.addEventListener("refresh_complete", ({ data }) => evidenceRefreshController.complete(JSON.parse(data)));
  source.addEventListener("refresh_error", ({ data }) => evidenceRefreshController.fail(JSON.parse(data)));
  source.addEventListener("error", (event) => {
    if (!event.data) return;
    const data = JSON.parse(event.data);
    if (applyRecoverableReport(data, { state, renderReportContent, renderProgressPanel })) state.eventSource?.close();
    showError(data.message || t("error.taskFailed", { zh: "任务执行失败" }));
  });
}

function applySnapshot(review) {
  if (review.id && review.id !== state.currentId) return;
  state.currentReview = review;
  state.stages = review.stages || state.stages;
  renderProgressPanel();
  if (review.report && review.reanalysisInProgress) showPreviousReportDuringReanalysis(review);
  else if (review.report) completeReport({ report: review.report, quality: review.quality, status: review.status, sources: review.sources, followupSuggestions: review.followupSuggestions }, { keepEvents: isEvidenceRefreshActive(review.evidenceRefresh) });
  evidenceRefreshController.render(review);
  if (review.error) showError(review.error);
}

function applyStage(stage) {
  state.stages = state.stages.map((item) => item.key === stage.key ? { ...item, ...stage } : item);
  applyDetectedCompany(stage, { state, elements, saveDraft: draft.save, refreshHistory: loadHistory });
  renderProgressPanel();
}

function applyReportDelta(delta) {
  state.report += delta || "";
  ensureReportCard(true);
  if (!state.reportRenderTimer) state.reportRenderTimer = setTimeout(() => {
    state.reportRenderTimer = null;
    renderReportContent(state.report, true);
  }, STREAM_RENDER_INTERVAL);
}

function completeReport(data, { keepEvents = false } = {}) {
  clearTimeout(state.reportRenderTimer);
  state.reportRenderTimer = null;
  if (data.report) state.report = data.report;
  const followupSuggestions = data.followupSuggestions || state.currentReview?.followupSuggestions || [];
  state.currentReview = { ...state.currentReview, reportAvailable: true, status: data.status || "completed", quality: data.quality, followupSuggestions };
  renderReportContent(state.report, false, data.quality);
  renderFollowupSuggestions(document.querySelector("#followupSuggestions"), followupSuggestions, askSuggestedFollowup);
  elements.promptInput.placeholder = t("composer.riskFollowup", { zh: "继续追问：最大的投资风险是什么？" });
  elements.companyInput.disabled = true;
  if (!keepEvents) state.eventSource?.close();
  loadHistory();
  scrollBottom();
}

function showPreviousReportDuringReanalysis(review) {
  renderReportContent(review.report, false, review.quality);
  state.report = "";
  document.querySelector(".report-footer")?.classList.add("hidden");
  document.querySelector("#followupSuggestions")?.classList.add("hidden");
}

async function loadReview(id) {
  try {
    const payload = await requestJson(`/api/reviews/${id}`);
    const review = payload.review;
    state.currentId = id;
    state.currentReview = review;
    state.stages = review.stages || [];
    state.report = review.report || "";
    showConversation();
    elements.messageStream.innerHTML = "";
    renderReviewRequest(elements.messageStream, { company: review.companyName, prompt: review.instruction, file: review.upload, taskType: review.taskType });
    renderProgressPanel();
    if (review.report && review.reanalysisInProgress) showPreviousReportDuringReanalysis(review);
    else if (review.report) completeReport({ report: review.report, quality: review.quality, status: review.status, sources: review.sources, followupSuggestions: review.followupSuggestions });
    evidenceRefreshController.render(review);
    for (const message of review.messages || []) renderChatMessage(message.role, message.content);
    if (["queued", "running"].includes(review.status) || isEvidenceRefreshActive(review.evidenceRefresh)) connectEvents(id);
    if (review.error) showError(review.error);
    elements.conversationTitle.textContent = localizedReviewTitle(review);
    elements.companyInput.value = review.companyName || "";
    elements.promptInput.value = lastUserInput(review) || review.instruction || "";
    autoResize();
    draft.save();
    elements.companyInput.disabled = Boolean(review.reportAvailable);
    elements.sidebar.classList.remove("open");
    await loadHistory();
  } catch (error) {
    toast(error.message);
  }
}

async function askFollowup(question) {
  if (!question) return toast(t("validation.question", { zh: "请输入问题" }));
  await runFollowup({ question, currentId: state.currentId, messageStream: elements.messageStream, requestResponse,
    renderUser: (value) => renderChatMessage("user", value), draft, setBusy, scrollBottom });
}

async function askSuggestedFollowup(question) {
  elements.promptInput.value = question;
  draft.save();
  await askFollowup(question);
}

function showConversation() {
  elements.emptyState.classList.add("hidden");
  elements.messageStream.classList.remove("hidden");
  syncConversationPdfButton(elements.conversationPdfButton, state.currentId);
}

function renderProgressPanel() {
  let panel = document.querySelector("#progressMessage");
  if (!panel) {
    elements.messageStream.insertAdjacentHTML("beforeend", `
      <article class="message assistant" id="progressMessage">
        <div class="message-meta"><span class="avatar">VL</span>${t("progress.agent", { zh: "研究代理" })}</div>
        <div class="assistant-card"><div class="progress-panel"><div class="progress-header"><strong>${t("progress.running", { zh: "研究进行中" })}</strong><span class="progress-badge">LIVE</span></div><div class="stage-list"></div></div></div>
      </article>`);
    panel = document.querySelector("#progressMessage");
  }
  const list = panel.querySelector(".stage-list");
  list.innerHTML = state.stages.map((stage) => { const copy = progressStageCopy(stage); return `
    <div class="stage ${escapeHtml(stage.status)}">
      <span class="stage-icon">${["completed", "restored"].includes(stage.status) ? "✓" : stage.status === "failed" ? "!" : ""}</span>
      <div><strong>${escapeHtml(copy.label)}</strong><p>${escapeHtml(copy.message)}</p></div>
      <span class="stage-time">${copy.time}</span>
    </div>`; }).join("");
  const taskLabel = taskTypeLabels(state.currentReview?.taskType).task;
  panel.querySelector(".progress-header strong").textContent = state.currentReview?.reportAvailable
    ? t("progress.taskDone", { zh: `${taskLabel}已完成`, task: taskLabel })
    : t("progress.taskRunning", { zh: `${taskLabel}进行中`, task: taskLabel });
  panel.querySelector(".progress-badge").textContent = state.currentReview?.reportAvailable ? "DONE" : "LIVE";
  scrollBottom();
}

function focusCurrentResearchStart() {
  state.autoFollow = false;
  focusResearchStart({ conversation: elements.conversation, progressPanel: document.querySelector("#progressMessage") });
}

function ensureReportCard(streaming) {
  let card = document.querySelector("#reportMessage");
  if (!card) {
    elements.messageStream.insertAdjacentHTML("beforeend", `
      <article class="message assistant" id="reportMessage">
        <div class="message-meta"><span class="avatar">VL</span>${t("report.bp", { zh: "核查报告" })}</div>
        <div class="report-card">
          <div class="report-toolbar"><div><span>BP REVIEW REPORT</span><strong>核查结果</strong></div><span class="quality-score hidden"></span></div>
          <div class="quality-summary hidden"></div>
          <div class="report-content"></div>
          <div class="report-footer ${streaming ? "hidden" : ""}">
            <button class="pdf-download-icon" data-download title="${t("report.download", { zh: "下载 PDF 核查报告" })}" aria-label="${t("report.download", { zh: "下载 PDF 核查报告" })}"><svg viewBox="0 0 52 62" aria-hidden="true"><path class="pdf-page" d="M8 2h25l11 11v47H8z"/><path class="pdf-fold" d="M33 2v12h11"/><text x="26" y="43" text-anchor="middle">PDF</text></svg></button>
            <button class="refresh-evidence-button" data-refresh-evidence>${t("report.refresh", { zh: "刷新公开资料" })}</button>
            <button class="reanalyze-button" data-reanalyze>重新核查</button>
          </div>
          <div class="followup-suggestions hidden" id="followupSuggestions"></div>
        </div>
      </article>`);
    card = document.querySelector("#reportMessage");
    card.querySelector("[data-download]").addEventListener("click", () => downloadReviewPdf(state.currentId));
    card.querySelector("[data-refresh-evidence]").addEventListener("click", evidenceRefreshController.start);
    card.querySelector("[data-reanalyze]").addEventListener("click", reanalyzeCurrentReview);
  }
  const labels = taskTypeLabels(state.currentReview?.taskType);
  card.querySelector(".message-meta").innerHTML = `<span class="avatar">VL</span>${labels.report}`;
  card.querySelector(".report-toolbar > div > span").textContent = labels.eyebrow;
  card.querySelector(".report-toolbar strong").textContent = labels.result;
  card.querySelector("[data-reanalyze]").textContent = labels.rerun;
  card.querySelector("[data-refresh-evidence]").classList.toggle("hidden", !supportsEvidenceRefresh(state.currentReview?.taskType));
  card.querySelector(".report-content").classList.toggle("stream-cursor", streaming);
  card.querySelector(".report-footer").classList.toggle("hidden", streaming);
  if (streaming) card.querySelector("#followupSuggestions")?.classList.add("hidden");
  return card;
}

function renderReportContent(markdown, streaming, quality) {
  const card = ensureReportCard(streaming);
  const content = card.querySelector(".report-content");
  content.innerHTML = streaming ? renderStreamingMarkdown(markdown) : markdownToHtml(markdown);
  content.classList.toggle("stream-cursor", streaming);
  content.classList.remove("streaming-plain");
  card.querySelector(".report-footer").classList.toggle("hidden", streaming);
  if (quality) {
    const badge = card.querySelector(".quality-score");
    badge.textContent = t("quality.score", { zh: `质量 ${quality.score}`, score: quality.score });
    badge.classList.toggle("attention", quality.ok === false);
    badge.classList.remove("hidden");
    renderQualitySummary(card.querySelector(".quality-summary"), quality);
  }
  scrollBottom();
}

function renderChatMessage(role, content, streaming = false) {
  const article = document.createElement("article");
  article.className = `message ${role === "user" ? "user" : "assistant"}`;
  article.innerHTML = `<div class="message-meta"><span class="avatar">${role === "user" ? t("message.you", { zh: "你" }) : "VL"}</span>${role === "user" ? t("message.followup", { zh: "你的追问" }) : t("progress.agent", { zh: "研究代理" })}</div>`;
  const body = document.createElement("div");
  body.className = role === "user" ? "message-body" : `assistant-card chat-answer-card report-content${streaming ? " stream-cursor streaming-plain" : ""}`;
  body.innerHTML = markdownToHtml(content);
  article.append(body);
  elements.messageStream.append(article);
  scrollBottom();
  return body;
}

function showError(message) {
  if (document.querySelector("#reviewError")) return;
  elements.messageStream.insertAdjacentHTML("beforeend", `<div class="error-card" id="reviewError"><strong>${t("error.interrupted", { zh: "核查中断" })}</strong><br>${escapeHtml(message)}. ${t("error.retained", { zh: "已有阶段结果和草稿已保留，可从历史记录重试。" })}</div>`);
  scrollBottom();
}

function resetWorkspace() {
  state.eventSource?.close();
  Object.assign(state, { currentId: "", currentReview: null, file: null, report: "", stages: [], autoFollow: true });
  elements.emptyState.classList.remove("hidden");
  elements.messageStream.classList.add("hidden");
  elements.messageStream.innerHTML = "";
  elements.conversationTitle.textContent = t("top.newBp", { zh: "新建 BP 核查" });
  elements.companyInput.value = "";
  elements.companyInput.disabled = false;
  elements.promptInput.value = "";
  elements.paperUrlInput.value = "";
  elements.industryResearchTemplate.value = "industry_overview";
  elements.promptInput.placeholder = t("composer.promptPlaceholder", { zh: "补充核查要求，或在报告完成后继续追问…" });
  clearFile();
  taskMode.selectAttachmentMode();
  draft.clear();
  autoResize();
  syncConversationPdfButton(elements.conversationPdfButton, "");
  loadHistory();
  elements.sidebar.classList.remove("open");
}

function setBusy(busy) {
  elements.sendButton.disabled = busy;
  document.querySelectorAll("[data-followup-suggestion]").forEach((button) => { button.disabled = busy; });
}

function autoResize() {
  elements.promptInput.style.height = "auto";
  elements.promptInput.style.height = `${Math.min(elements.promptInput.scrollHeight, 110)}px`;
}

function scrollBottom(force = false) {
  if (!force && !state.autoFollow) return;
  requestAnimationFrame(() => elements.conversation.scrollTo({ top: elements.conversation.scrollHeight, behavior: "auto" }));
}

function isNearConversationBottom() {
  return elements.conversation.scrollHeight - elements.conversation.scrollTop - elements.conversation.clientHeight < 120;
}

function toast(message) {
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  elements.toastRegion.append(item);
  setTimeout(() => item.remove(), 3800);
}
