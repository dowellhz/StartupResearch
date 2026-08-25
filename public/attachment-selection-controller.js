import { selectAttachmentFiles, totalAttachmentBytes } from "./attachment-selection.js";
import { ATTACHMENT_REVIEW, PAPER_ANALYSIS, taskTypeForFileInput } from "./composer-task-mode.js";
import { t } from "./i18n.js";
import { sanitizeVisibleFilename } from "./privacy-redaction.js";
import { formatBytes } from "./review-request-message.js";
import { enterUploadedBpCompanyContext, restoreCurrentCompanyContext, setUploadAnalysisState } from "./upload-company-context.js";

export function createAttachmentSelectionController({ elements, state, taskMode, notify }) {
  function select(values) {
    const incoming = Array.from(values || []);
    const fileTaskType = taskTypeForFileInput(state.taskType);
    const matchingRequired = Boolean(state.currentId && state.currentReview?.reportAvailable && (!state.currentReview.taskType || state.currentReview.taskType === ATTACHMENT_REVIEW));
    const allowMultiple = fileTaskType === ATTACHMENT_REVIEW && !matchingRequired;
    const result = selectAttachmentFiles({ existing: allowMultiple ? state.files : [], incoming, allowMultiple, paperAnalysis: fileTaskType === PAPER_ANALYSIS });
    if (!result.ok) return notify(selectionError(result.code));
    if (result.code === "single_only") notify(t("validation.oneFile", { zh: "当前操作一次只能上传一份资料，已选择第一份" }));
    if (fileTaskType === PAPER_ANALYSIS) taskMode.selectPaperAnalysisMode();
    else taskMode.selectAttachmentMode();
    state.files = result.files;
    state.file = result.files[0];
    elements.fileInput.value = "";
    const attachmentReview = fileTaskType === PAPER_ANALYSIS || state.currentReview?.taskType !== ATTACHMENT_REVIEW ? null : state.currentReview;
    const needsMatch = enterUploadedBpCompanyContext(elements.companyInput, attachmentReview);
    elements.fileName.textContent = selectionName(result.files);
    const pending = fileTaskType === PAPER_ANALYSIS ? t("file.paperPending", { zh: "等待论文解读" }) : needsMatch ? t("file.companyPending", { zh: "提交后识别是否属于当前公司" }) : t("file.reviewPending", { zh: "等待核查" });
    elements.fileMeta.textContent = `${formatBytes(totalAttachmentBytes(result.files))} · ${pending}`;
    elements.filePreview.classList.remove("hidden");
  }

  function clear() {
    setUploadAnalysisState(elements, { active: false });
    state.file = null;
    state.files = [];
    elements.fileInput.value = "";
    elements.filePreview.classList.add("hidden");
    restoreCurrentCompanyContext(elements.companyInput, state.currentReview);
  }

  return { clear, select };
}

function selectionName(files) {
  if (files.length === 1) return sanitizeVisibleFilename(files[0].name);
  const names = files.slice(0, 3).map((file) => sanitizeVisibleFilename(file.name)).join("、");
  return `${files.length} 份资料：${names}${files.length > 3 ? "…" : ""}`;
}

function selectionError(code) {
  const values = {
    too_many: t("validation.tooManyFiles", { zh: "首次最多上传 8 份资料" }),
    file_type: t("validation.fileTypes", { zh: "请上传 PDF、PPTX、DOCX、TXT 或 Markdown" }),
    paper_pdf: t("validation.paperPdf", { zh: "论文解读仅支持 PDF 文件" }),
    file_size: t("validation.fileSize", { zh: "单份文件不能超过 20 MB" }),
    total_size: t("validation.totalFileSize", { zh: "所有资料合计不能超过 20 MB" })
  };
  return values[code] || t("validation.fileRead", { zh: "未能读取所选文件" });
}
