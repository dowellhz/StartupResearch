import { escapeHtml, markdownToHtml } from "./markdown-renderer.js";
import { createComposerDraftController, lastUserInput } from "./composer-draft.js";
import { bindFileDrop } from "./file-drop.js";
import { renderFollowupSuggestions } from "./followup-suggestions.js";
import { renderHistoryList } from "./history-list.js";
import { requestJson, requestResponse } from "./http-client.js";
import { applyDetectedCompany } from "./review-identity.js";
import { applyRecoverableReport } from "./review-error.js";
import { applyUploadRouting, submitUploadedBp } from "./review-submit.js";
import { enterUploadedBpCompanyContext, restoreCurrentCompanyContext, setUploadAnalysisState } from "./upload-company-context.js";
import { sanitizeVisibleFilename } from "./privacy-redaction.js";
import { runFollowup } from "./followup-controller.js";
import { renderStreamingMarkdown, STREAM_RENDER_INTERVAL } from "./streaming-markdown.js";
const elements = {
  attachButton: document.querySelector("#attachButton"),
  closeHelp: document.querySelector("#closeHelp"),
  companyInput: document.querySelector("#companyInput"),
  composer: document.querySelector("#composer"),
  conversation: document.querySelector("#conversation"),
  conversationTitle: document.querySelector("#conversationTitle"),
  emptyState: document.querySelector("#emptyState"),
  fileInput: document.querySelector("#fileInput"),
  fileMeta: document.querySelector("#fileMeta"),
  fileName: document.querySelector("#fileName"),
  filePreview: document.querySelector("#filePreview"),
  helpButton: document.querySelector("#helpButton"),
  helpDialog: document.querySelector("#helpDialog"),
  historyList: document.querySelector("#historyList"),
  menuButton: document.querySelector("#menuButton"),
  messageStream: document.querySelector("#messageStream"),
  modelDot: document.querySelector("#modelDot"),
  modelText: document.querySelector("#modelText"),
  newReviewButton: document.querySelector("#newReviewButton"),
  promptInput: document.querySelector("#promptInput"),
  removeFile: document.querySelector("#removeFile"),
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
  autoFollow: true
};
boot();

async function boot() {
  bindEvents();
  draft.restore();
  await Promise.all([checkHealth(), loadHistory()]);
}
function bindEvents() {
  elements.attachButton.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", () => selectFile(elements.fileInput.files[0]));
  bindFileDrop({ dropZone: elements.composer, onFile: selectFile, onMultiple: () => toast("一次只能上传一份 BP，已选择第一个文件") });
  elements.removeFile.addEventListener("click", clearFile);
  elements.composer.addEventListener("submit", submitComposer);
  elements.newReviewButton.addEventListener("click", resetWorkspace);
  elements.helpButton.addEventListener("click", () => elements.helpDialog.showModal());
  elements.closeHelp.addEventListener("click", () => elements.helpDialog.close());
  elements.menuButton.addEventListener("click", () => elements.sidebar.classList.toggle("open"));
  elements.companyInput.addEventListener("input", draft.saveCompany);
  elements.promptInput.addEventListener("input", () => {
    autoResize();
    draft.save();
  });
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
async function checkHealth() {
  try {
    const payload = await requestJson("/api/health");
    elements.modelDot.className = `status-dot ${payload.modelConfigured ? "online" : "offline"}`;
    elements.modelText.textContent = payload.modelConfigured ? `${payload.model} 已连接` : "DeepSeek 未配置";
  } catch {
    elements.modelDot.className = "status-dot offline";
    elements.modelText.textContent = "服务不可用";
  }
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
  if (!allowed.includes(extension)) return toast("请上传 PDF、PPTX、DOCX、TXT 或 Markdown");
  if (file.size > 20 * 1024 * 1024) return toast("文件不能超过 20 MB");
  state.file = file;
  const matchingRequired = enterUploadedBpCompanyContext(elements.companyInput, state.currentReview);
  elements.fileName.textContent = sanitizeVisibleFilename(file.name);
  elements.fileMeta.textContent = `${formatBytes(file.size)} · ${matchingRequired ? "提交后识别公司并判断是否新建对话" : "等待核查"}`;
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
  if (state.currentReview?.reportAvailable && !state.file) return askFollowup(prompt);
  if (!state.file) return toast("请先上传商业计划书");
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
      instruction: prompt || "全面核查这份 BP",
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
    renderUserMessage(payload.review.companyName || payload.decision?.newCompanyName || companyName, prompt || "全面核查这份 BP", file);
    draft.clearCompany();
    draft.clearPrompt();
    renderProgressPanel();
    elements.conversationTitle.textContent = payload.review.title;
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

function connectEvents(id) {
  state.eventSource?.close();
  const source = new EventSource(`/api/reviews/${id}/events`);
  state.eventSource = source;
  source.addEventListener("snapshot", ({ data }) => applySnapshot(JSON.parse(data)));
  source.addEventListener("stage", ({ data }) => applyStage(JSON.parse(data)));
  source.addEventListener("report_delta", ({ data }) => applyReportDelta(JSON.parse(data).delta));
  source.addEventListener("report_complete", ({ data }) => completeReport(JSON.parse(data)));
  source.addEventListener("error", (event) => {
    if (!event.data) return;
    const data = JSON.parse(event.data);
    if (applyRecoverableReport(data, { state, renderReportContent, renderProgressPanel })) state.eventSource?.close();
    showError(data.message || "任务执行失败");
  });
}

function applySnapshot(review) {
  if (review.id && review.id !== state.currentId) return;
  state.currentReview = review;
  state.stages = review.stages || state.stages;
  renderProgressPanel();
  if (review.report && review.reanalysisInProgress) showPreviousReportDuringReanalysis(review);
  else if (review.report) completeReport({ report: review.report, quality: review.quality, status: review.status, sources: review.sources, followupSuggestions: review.followupSuggestions });
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

function completeReport(data) {
  clearTimeout(state.reportRenderTimer);
  state.reportRenderTimer = null;
  if (data.report) state.report = data.report;
  const followupSuggestions = data.followupSuggestions || state.currentReview?.followupSuggestions || [];
  state.currentReview = { ...state.currentReview, reportAvailable: true, status: data.status || "completed", quality: data.quality, followupSuggestions };
  renderReportContent(state.report, false, data.quality);
  renderFollowupSuggestions(document.querySelector("#followupSuggestions"), followupSuggestions, askSuggestedFollowup);
  elements.promptInput.placeholder = "继续追问：最大的投资风险是什么？";
  elements.companyInput.disabled = true;
  state.eventSource?.close();
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
    renderUserMessage(review.companyName, review.instruction, review.upload);
    renderProgressPanel();
    if (review.report && review.reanalysisInProgress) showPreviousReportDuringReanalysis(review);
    else if (review.report) completeReport({ report: review.report, quality: review.quality, status: review.status, sources: review.sources, followupSuggestions: review.followupSuggestions });
    for (const message of review.messages || []) renderChatMessage(message.role, message.content);
    if (["queued", "running"].includes(review.status)) connectEvents(id);
    if (review.error) showError(review.error);
    elements.conversationTitle.textContent = review.title;
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
  if (!question) return toast("请输入问题");
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
}

function renderUserMessage(company, prompt, file) {
  const name = sanitizeVisibleFilename(file?.name || file?.filename || "BP 文件");
  const size = file?.size ? ` · ${formatBytes(file.size)}` : "";
  elements.messageStream.insertAdjacentHTML("beforeend", `
    <article class="message user">
      <div class="message-meta"><span class="avatar">你</span>你的请求</div>
      <div class="message-body"><strong class="request-company">${escapeHtml(company || "由 BP 自动识别公司")}</strong><br>${escapeHtml(prompt)}
        <div class="file-inline"><b>BP</b><span>${escapeHtml(name)}${size}</span></div>
      </div>
    </article>`);
}

function renderProgressPanel() {
  let panel = document.querySelector("#progressMessage");
  if (!panel) {
    elements.messageStream.insertAdjacentHTML("beforeend", `
      <article class="message assistant" id="progressMessage">
        <div class="message-meta"><span class="avatar">VL</span>研究代理</div>
        <div class="assistant-card"><div class="progress-panel"><div class="progress-header"><strong>BP 核查进行中</strong><span class="progress-badge">LIVE</span></div><div class="stage-list"></div></div></div>
      </article>`);
    panel = document.querySelector("#progressMessage");
  }
  const list = panel.querySelector(".stage-list");
  list.innerHTML = state.stages.map((stage) => `
    <div class="stage ${escapeHtml(stage.status)}">
      <span class="stage-icon">${["completed", "restored"].includes(stage.status) ? "✓" : stage.status === "failed" ? "!" : ""}</span>
      <div><strong>${escapeHtml(stage.label)}</strong><p>${escapeHtml(stage.message || stageStatusCopy(stage.status))}</p></div>
      <span class="stage-time">${stage.status === "running" ? "处理中" : ["completed", "restored"].includes(stage.status) ? "完成" : ""}</span>
    </div>`).join("");
  panel.querySelector(".progress-header strong").textContent = state.currentReview?.reportAvailable ? "BP 核查已完成" : "BP 核查进行中";
  panel.querySelector(".progress-badge").textContent = state.currentReview?.reportAvailable ? "DONE" : "LIVE";
  scrollBottom();
}

function ensureReportCard(streaming) {
  let card = document.querySelector("#reportMessage");
  if (!card) {
    elements.messageStream.insertAdjacentHTML("beforeend", `
      <article class="message assistant" id="reportMessage">
        <div class="message-meta"><span class="avatar">VL</span>核查报告</div>
        <div class="report-card">
          <div class="report-toolbar"><div><span>BP REVIEW REPORT</span><strong>核查结果</strong></div><span class="quality-score hidden"></span></div>
          <div class="quality-summary hidden"></div>
          <div class="report-content"></div>
          <div class="report-footer ${streaming ? "hidden" : ""}">
            <button class="pdf-download-icon" data-download title="下载 PDF 核查报告" aria-label="下载 PDF 核查报告"><svg viewBox="0 0 52 62" aria-hidden="true"><path class="pdf-page" d="M8 2h25l11 11v47H8z"/><path class="pdf-fold" d="M33 2v12h11"/><text x="26" y="43" text-anchor="middle">PDF</text></svg></button>
            <button class="reanalyze-button" data-reanalyze>重新核查</button>
          </div>
          <div class="followup-suggestions hidden" id="followupSuggestions"></div>
        </div>
      </article>`);
    card = document.querySelector("#reportMessage");
    card.querySelector("[data-download]").addEventListener("click", downloadCurrentPdf);
    card.querySelector("[data-reanalyze]").addEventListener("click", reanalyzeCurrentReview);
  }
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
    badge.textContent = `质量 ${quality.score}`;
    badge.classList.toggle("attention", quality.ok === false);
    badge.classList.remove("hidden");
    renderQualitySummary(card.querySelector(".quality-summary"), quality);
  }
  scrollBottom();
}

function renderQualitySummary(container, quality) {
  const metrics = quality.metrics || {};
  const findings = (quality.findings || []).map((item) => typeof item === "string" ? item : item.message).filter(Boolean);
  const values = [
    metrics.sourceCount === undefined ? "" : `证据片段 ${metrics.evidenceRichCount || 0}/${metrics.sourceCount}`,
    metrics.importantClaimCount === undefined ? "" : `声明覆盖 ${metrics.coveredClaimCount || 0}/${metrics.importantClaimCount}`,
    metrics.claimLedgerCount ? `声明卡 ${metrics.supportedLedgerClaimCount || 0}/${metrics.claimLedgerCount} 获支持` : "",
    metrics.auditedMetricCount ? `数字审计 ${metrics.numericCheckCount || 0} 项检查` : "",
    metrics.extractionCompleteness === undefined ? "" : `解析完整度 ${Math.round(Number(metrics.extractionCompleteness) * 100)}%`
  ].filter(Boolean);
  container.innerHTML = `
    <div class="quality-metrics">${values.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>
    ${findings.length ? `<details><summary>${findings.length} 个质量提示</summary><ul>${findings.slice(0, 6).map((message) => `<li>${escapeHtml(message)}</li>`).join("")}</ul></details>` : ""}`;
  container.classList.toggle("hidden", !values.length && !findings.length);
}

function renderChatMessage(role, content, streaming = false) {
  const article = document.createElement("article");
  article.className = `message ${role === "user" ? "user" : "assistant"}`;
  article.innerHTML = `<div class="message-meta"><span class="avatar">${role === "user" ? "你" : "VL"}</span>${role === "user" ? "你的追问" : "研究代理"}</div>`;
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
  elements.messageStream.insertAdjacentHTML("beforeend", `<div class="error-card" id="reviewError"><strong>核查中断</strong><br>${escapeHtml(message)}。已有阶段结果和草稿已保留，可从历史记录重试。</div>`);
  scrollBottom();
}

function resetWorkspace() {
  state.eventSource?.close();
  Object.assign(state, { currentId: "", currentReview: null, file: null, report: "", stages: [], autoFollow: true });
  elements.emptyState.classList.remove("hidden");
  elements.messageStream.classList.add("hidden");
  elements.messageStream.innerHTML = "";
  elements.conversationTitle.textContent = "新建 BP 核查";
  elements.companyInput.value = "";
  elements.companyInput.disabled = false;
  elements.promptInput.value = "";
  elements.promptInput.placeholder = "补充核查要求，或在报告完成后继续追问…";
  clearFile();
  draft.clear();
  loadHistory();
  elements.sidebar.classList.remove("open");
}

function downloadCurrentPdf() {
  if (state.currentId) window.location.href = `/api/reviews/${state.currentId}/pdf`;
}

async function reanalyzeCurrentReview() {
  if (!state.currentId || !window.confirm("将使用已保存的原始 BP 重新解析并核查。旧报告会先归档，是否继续？")) return;
  try {
    const payload = await requestJson(`/api/reviews/${state.currentId}/reanalyze`, { method: "POST" });
    state.currentReview = payload.review;
    state.stages = payload.review.stages || [];
    state.report = "";
    document.querySelector("[data-reanalyze]")?.setAttribute("disabled", "");
    renderProgressPanel();
    connectEvents(state.currentId);
    toast("已开始增强解析，旧报告已归档");
  } catch (error) {
    toast(error.message);
  }
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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function stageStatusCopy(status) {
  return ({ pending: "等待前序步骤", running: "正在处理", completed: "已完成", restored: "已恢复", failed: "执行失败" })[status] || "";
}
