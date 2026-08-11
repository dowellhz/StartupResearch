import { createHash } from "node:crypto";
import { createIndustryResearchJob } from "./industry-research-pipeline.js";
import { createPaperAnalysisJob } from "./paper-analysis-pipeline.js";
import { normalizeOutputLanguage } from "./report-language.js";

export const INDUSTRY_RESEARCH = "industry_research";
export const TECHNOLOGY_RESEARCH = "technology_research";
export const PAPER_ANALYSIS = "paper_analysis";

export function createSpecialResearchTaskService({ repository, industryResearchPipeline, paperAnalysisPipeline, enqueue = () => {}, pendingCreates = new Map(), now = () => new Date().toISOString() } = {}) {
  const pipelines = new Map([
    [INDUSTRY_RESEARCH, industryResearchPipeline],
    [TECHNOLOGY_RESEARCH, industryResearchPipeline],
    [PAPER_ANALYSIS, paperAnalysisPipeline]
  ].filter(([, pipeline]) => pipeline));

  function handles(taskType) {
    return pipelines.has(taskType);
  }

  function pipelineFor(taskType) {
    return pipelines.get(taskType) || null;
  }

  async function create(input, { ownerId } = {}) {
    const taskType = input?.taskType;
    const selectedPipeline = pipelineFor(taskType);
    if (!selectedPipeline) throw new Error("研究任务类型未启用");
    const normalized = [INDUSTRY_RESEARCH, TECHNOLOGY_RESEARCH].includes(taskType) ? normalizeTopicResearchInput(input) : normalizePaperInput(input);
    const key = createKey(ownerId, normalized);
    if (pendingCreates.has(key)) return pendingCreates.get(key);
    const promise = createOnce(normalized, selectedPipeline, ownerId).finally(() => pendingCreates.delete(key));
    pendingCreates.set(key, promise);
    return promise;
  }

  async function createOnce(input, selectedPipeline, ownerId) {
    const duplicates = await repository.list?.({ ownerId, limit: 100 }) || [];
    const active = duplicates.find((job) => ["queued", "running"].includes(job.status) && duplicateKey(job) === duplicateKey(input));
    if (active) return active;
    let upload = null;
    let buffer = null;
    if (input.upload?.data) {
      buffer = Buffer.from(input.upload.data, "base64");
      upload = { ...input.upload, data: "", sha256: createHash("sha256").update(buffer).digest("hex") };
    }
    let job = [INDUSTRY_RESEARCH, TECHNOLOGY_RESEARCH].includes(input.taskType)
      ? createIndustryResearchJob({ taskType: input.taskType, topic: input.companyName, instruction: input.instruction, outputLanguage: input.outputLanguage, researchTemplate: input.researchTemplate, steps: selectedPipeline.steps, now })
      : createPaperAnalysisJob({ title: input.companyName, instruction: input.instruction, outputLanguage: input.outputLanguage, sourceUrl: input.sourceUrl, upload, steps: selectedPipeline.steps, now });
    job.ownerId = ownerId;
    if (buffer && repository.saveUpload) {
      const storagePath = await repository.saveUpload(job.id, buffer);
      job.upload = { ...job.upload, persisted: true, storagePath };
    }
    job = await repository.save(job);
    enqueue(job.id);
    return job;
  }

  return { create, handles, pipelineFor };
}

function normalizeTopicResearchInput(input) {
  const companyName = singleLine(input.companyName, 300);
  if (!companyName) throw new Error(input.taskType === TECHNOLOGY_RESEARCH ? "技术调研需要填写技术主题" : "行业研究需要填写行业或技术主题");
  const technology = input.taskType === TECHNOLOGY_RESEARCH;
  return { taskType: technology ? TECHNOLOGY_RESEARCH : INDUSTRY_RESEARCH, companyName, instruction: singleLine(input.instruction, 4000) || (technology ? "完成技术调研" : "完成行业概览研究"), outputLanguage: normalizeOutputLanguage(input.outputLanguage), researchTemplate: technology ? "technical" : (["industry_overview", "technical", "commercial", "investment"].includes(input.researchTemplate) ? input.researchTemplate : "industry_overview") };
}

function normalizePaperInput(input) {
  const sourceUrl = String(input.sourceUrl || "").trim();
  const upload = input.upload?.data && input.upload?.filename ? input.upload : null;
  if (!upload && !/^https?:\/\//i.test(sourceUrl)) throw new Error("论文解读需要上传 PDF 或填写论文 URL");
  if (upload && !/\.pdf$/i.test(upload.filename) && !/application\/pdf/i.test(upload.mimeType || "")) throw new Error("论文解读仅支持 PDF 文件");
  return { taskType: PAPER_ANALYSIS, companyName: singleLine(input.companyName, 500), instruction: singleLine(input.instruction, 4000) || "从技术、可信度、行业价值和商业化角度解读论文", outputLanguage: normalizeOutputLanguage(input.outputLanguage), sourceUrl, upload };
}

function createKey(ownerId, input) {
  const uploadHash = input.upload?.data ? createHash("sha256").update(Buffer.from(input.upload.data, "base64")).digest("hex") : "";
  return `${ownerId}:${duplicateKey({ ...input, upload: input.upload ? { ...input.upload, sha256: uploadHash } : null })}`;
}

function duplicateKey(value) {
  return [value.taskType, normalizeComparable(value.companyName), normalizeComparable(value.instruction), value.outputLanguage || "zh", value.researchTemplate || "", String(value.sourceUrl || "").toLowerCase(), value.upload?.sha256 || ""].join(":");
}

function singleLine(value, limit) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit); }
function normalizeComparable(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, ""); }
