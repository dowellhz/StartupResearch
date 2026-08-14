import { publicRefresh } from "./evidence-refresh-service.js";
import { INDUSTRY_RESEARCH, PAPER_ANALYSIS } from "./special-research-task-service.js";

export function publicJob(job) {
  const { upload, checkpoints, ownerId, previousReportArchive, previousAnalysisSnapshot, analysis, evidenceRefresh, ...safe } = job;
  return {
    ...safe,
    taskType: taskTypeOf(job),
    upload: upload ? { filename: upload.filename, mimeType: upload.mimeType, size: upload.size } : null,
    checkpointCount: Object.keys(checkpoints || {}).length,
    evidenceRefresh: publicRefresh(evidenceRefresh)
  };
}

export function buildPreviousAnalysisSnapshot(job) {
  if (!job?.analysis && !job?.investmentAnalysis && !job?.businessAudit) return null;
  return {
    completedAt: job.completedAt || "",
    filename: job.upload?.filename || "",
    sha256: job.upload?.sha256 || "",
    analysis: {
      companyProfile: job.analysis?.companyProfile || {},
      claims: array(job.analysis?.claims).slice(0, 40).map(compactRecord),
      risks: array(job.analysis?.risks).slice(0, 30).map(compactRecord),
      missingInformation: array(job.analysis?.missingInformation).slice(0, 30).map((item) => compactText(item, 500))
    },
    businessAudit: {
      summary: job.businessAudit?.summary || {},
      metrics: array(job.businessAudit?.metrics).slice(0, 50).map(compactRecord),
      checks: array(job.businessAudit?.checks).slice(0, 30).map(compactRecord),
      assumptions: array(job.businessAudit?.assumptions).slice(0, 30).map(compactRecord)
    },
    investmentAnalysis: job.investmentAnalysis || null
  };
}

export function recoverableRestartKey(job) {
  if (job.extractionWarning) return ({ company_pre_research: "fact-extraction", industry_research: "evidence-synthesis", paper_analysis: "metadata-extraction" })[taskTypeOf(job)] || "claim-extraction";
  if (job.investmentAnalysisWarning) return "investment-analysis";
  if (job.generationWarning) return "report-generation";
  return "";
}

export function resetPipelineFrom(job, steps, restartKey) {
  if (!restartKey) return job;
  const start = steps.findIndex((step) => step.key === restartKey);
  if (start < 0) return job;
  const resetKeys = new Set(steps.slice(start).map((step) => step.key));
  return {
    ...job,
    checkpoints: Object.fromEntries(Object.entries(job.checkpoints || {}).filter(([key]) => !resetKeys.has(key))),
    stages: array(job.stages).map((stage) => resetKeys.has(stage.key) ? { ...stage, status: "pending", message: "" } : stage),
    extractionWarning: ["claim-extraction", "fact-extraction"].includes(restartKey) ? "" : job.extractionWarning,
    investmentAnalysisWarning: ["claim-extraction", "investment-analysis"].includes(restartKey) ? "" : job.investmentAnalysisWarning,
    generationWarning: ["claim-extraction", "fact-extraction", "investment-analysis", "report-generation"].includes(restartKey) ? "" : job.generationWarning
  };
}

export function assertNoEvidenceRefresh(job) {
  if (["queued", "running"].includes(job.evidenceRefresh?.status)) throw new Error("公开资料正在刷新，请完成后再执行其他核查操作");
}

export function assertOwnerId(ownerId) {
  if (!ownerId) throw Object.assign(new Error("匿名浏览器身份无效"), { statusCode: 401 });
}

export function normalizeInstruction(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeComparable(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}

export function taskTypeOf(job) {
  if (["company_pre_research", INDUSTRY_RESEARCH, PAPER_ANALYSIS].includes(job?.taskType)) return job.taskType;
  return "attachment_review";
}

export function array(value) { return Array.isArray(value) ? value : []; }

function compactRecord(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [key,
    Array.isArray(item) ? item.slice(0, 20).map((entry) => compactText(entry, 500)) : compactText(item, 800)
  ]));
}

function compactText(value, limit) {
  if (value === null || value === undefined) return "";
  return String(typeof value === "object" ? JSON.stringify(value) : value).slice(0, limit);
}
