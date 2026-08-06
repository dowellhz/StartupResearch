import { createHash } from "node:crypto";
import { createReviewJob } from "./bp-review-pipeline.js";
import { createCompanyPreResearchJob } from "./company-pre-research-pipeline.js";
import { publicRefresh } from "./evidence-refresh-service.js";
import { buildFollowupMessages } from "./review-prompts.js";
import { normalizeReviewReport } from "./report-summary-service.js";
import { normalizeOutputLanguage } from "./report-language.js";
import { createSpecialResearchTaskService, INDUSTRY_RESEARCH, PAPER_ANALYSIS } from "./special-research-task-service.js";
import { transitionReview } from "./review-state-machine.js";
import { redactSensitiveText } from "../../public/privacy-redaction.js";

export function createReviewManagerService({ pipeline, companyResearchPipeline, industryResearchPipeline, paperAnalysisPipeline, repository, model, evidenceRefreshService, now = () => new Date().toISOString() }) {
  const subscribers = new Map();
  const controllers = new Map();
  const refreshControllers = new Map();
  const deletedIds = new Set();
  const pendingCreates = new Map();
  const specialResearchTasks = createSpecialResearchTaskService({
    repository,
    industryResearchPipeline,
    paperAnalysisPipeline,
    pendingCreates,
    now,
    enqueue: (id) => queueMicrotask(() => run(id).catch(() => {}))
  });

  async function create({ taskType = "attachment_review", companyName, instruction, outputLanguage, upload, researchTemplate, sourceUrl }, { ownerId } = {}) {
    assertOwnerId(ownerId);
    outputLanguage = normalizeOutputLanguage(outputLanguage);
    if (taskType === "company_pre_research") return createCompanyResearch({ companyName, instruction, outputLanguage }, { ownerId });
    if (specialResearchTasks.handles(taskType)) {
      return publicJob(await specialResearchTasks.create({ taskType, companyName, instruction, outputLanguage, upload, researchTemplate, sourceUrl }, { ownerId }));
    }
    if (!upload?.data || !upload?.filename) throw new Error("请先上传商业计划书");
    const buffer = Buffer.from(upload.data, "base64");
    const uploadHash = createHash("sha256").update(buffer).digest("hex");
    const createKey = `${ownerId}:${uploadHash}:${normalizeInstruction(instruction)}`;
    if (pendingCreates.has(createKey)) return pendingCreates.get(createKey);
    const promise = createOnce({ companyName, instruction, outputLanguage, upload, buffer, uploadHash }, { ownerId })
      .finally(() => pendingCreates.delete(createKey));
    pendingCreates.set(createKey, promise);
    return promise;
  }

  async function createCompanyResearch({ companyName, instruction, outputLanguage }, { ownerId }) {
    if (!companyResearchPipeline) throw new Error("公司预研服务未启用");
    const name = String(companyName || "").replace(/\s+/g, " ").trim();
    if (!name) throw new Error("公司预研需要填写公司名称");
    const researchInstruction = normalizeInstruction(instruction) || "基于公开信息完成公司预研";
    const createKey = `${ownerId}:company_pre_research:${name.toLowerCase()}:${researchInstruction}:${outputLanguage || "zh"}`;
    if (pendingCreates.has(createKey)) return pendingCreates.get(createKey);
    const promise = createCompanyResearchOnce({ companyName: name, instruction: researchInstruction, outputLanguage }, { ownerId })
      .finally(() => pendingCreates.delete(createKey));
    pendingCreates.set(createKey, promise);
    return promise;
  }

  async function createCompanyResearchOnce({ companyName, instruction, outputLanguage }, { ownerId }) {
    const activeDuplicate = (await repository.list?.({ ownerId, limit: 100 }) || []).find((job) =>
      job.taskType === "company_pre_research"
      && ["queued", "running"].includes(job.status)
      && normalizeComparable(job.companyName) === normalizeComparable(companyName)
      && normalizeInstruction(job.instruction) === normalizeInstruction(instruction)
      && (job.outputLanguage || "zh") === (outputLanguage || "zh"));
    if (activeDuplicate) return publicJob(activeDuplicate);
    const job = {
      ...createCompanyPreResearchJob({ companyName, instruction, outputLanguage, steps: companyResearchPipeline.steps, now }),
      ownerId
    };
    await repository.save(job);
    queueMicrotask(() => run(job.id).catch(() => {}));
    return publicJob(job);
  }

  async function createOnce({ companyName, instruction, outputLanguage, upload, buffer, uploadHash }, { ownerId }) {
    const activeDuplicate = (await repository.list?.({ ownerId, limit: 100 }) || []).find((job) =>
      ["queued", "running"].includes(job.status)
      && job.upload?.sha256 === uploadHash
      && normalizeInstruction(job.instruction) === normalizeInstruction(instruction)
      && (job.outputLanguage || "zh") === (outputLanguage || "zh"));
    if (activeDuplicate) return publicJob(activeDuplicate);
    let job = {
      ...createReviewJob({ companyName, instruction, outputLanguage, upload: { ...upload, sha256: uploadHash }, steps: pipeline.steps, now }),
      ownerId
    };
    if (typeof repository.saveUpload === "function") {
      const storagePath = await repository.saveUpload(job.id, buffer);
      job = { ...job, upload: { ...job.upload, data: "", persisted: true, storagePath } };
    }
    await repository.save(job);
    queueMicrotask(() => run(job.id).catch(() => {}));
    return publicJob(job);
  }

  async function retry(id, { ownerId } = {}) {
    const existing = await requireOwnedJob(id, ownerId);
    assertNoEvidenceRefresh(existing);
    if (!new Set(["failed", "needs_attention"]).has(existing.status)) throw new Error("只有失败或需关注的任务可以重试");
    const selectedPipeline = pipelineFor(existing);
    const restartKey = recoverableRestartKey(existing);
    const resumed = resetPipelineFrom(transitionReview(existing, "running"), selectedPipeline.steps, restartKey);
    const saved = await repository.save({ ...resumed, error: "", failedStep: "" });
    queueMicrotask(() => run(id).catch(() => {}));
    return publicJob(saved);
  }

  async function reanalyze(id, { ownerId, outputLanguage } = {}) {
    const existing = await requireOwnedJob(id, ownerId);
    assertNoEvidenceRefresh(existing);
    if (existing.status === "running") throw new Error("任务正在运行，无需重复提交");
    const selectedPipeline = pipelineFor(existing);
    if (["attachment_review", PAPER_ANALYSIS].includes(taskTypeOf(existing)) && !existing.sourceUrl) {
      const upload = await repository.getUpload?.(id, existing.upload?.storagePath);
      if (!upload?.length) throw new Error("原始 BP 未保存，请重新上传文件发起核查");
    }
    const archivedReport = await repository.archiveReport?.(id);
    const resumed = transitionReview(existing, "running");
    const job = await repository.save({
      ...resumed,
      outputLanguage: outputLanguage ? normalizeOutputLanguage(outputLanguage) : existing.outputLanguage || "zh",
      checkpoints: {},
      stages: selectedPipeline.steps.map((step) => ({ ...step, status: "pending" })),
      error: "",
      failedStep: "",
      reanalysisInProgress: true,
      previousAnalysisSnapshot: null,
      previousReportArchive: archivedReport || ""
    });
    queueMicrotask(() => run(id).catch(() => {}));
    return publicJob(job);
  }

  async function replaceBp(id, { instruction, outputLanguage, upload }, { ownerId } = {}) {
    const existing = await requireOwnedJob(id, ownerId);
    if (taskTypeOf(existing) !== "attachment_review") throw new Error("公司预研对话不支持替换 BP，请新建附件核查");
    assertNoEvidenceRefresh(existing);
    if (existing.status === "running") throw new Error("任务正在运行，请完成后再上传新版 BP");
    if (!upload?.data || !upload?.filename) throw new Error("请上传新版商业计划书");
    const buffer = Buffer.from(upload.data, "base64");
    const uploadHash = createHash("sha256").update(buffer).digest("hex");
    const storagePath = await repository.saveUpload(id, buffer);
    const archivedReport = await repository.archiveReport?.(id);
    const previousAnalysisSnapshot = buildPreviousAnalysisSnapshot(existing);
    const resumed = transitionReview(existing, "running");
    const messages = [
      ...(existing.messages || []),
      { role: "user", content: `上传同一公司的新版 BP：${upload.filename}${instruction ? `\n${instruction}` : ""}`, at: now() }
    ].slice(-20);
    const job = await repository.save({
      ...resumed,
      instruction: String(instruction || existing.instruction || "全面核查这份 BP").trim(),
      outputLanguage: outputLanguage ? normalizeOutputLanguage(outputLanguage) : existing.outputLanguage || "zh",
      upload: { filename: upload.filename, mimeType: upload.mimeType, size: upload.size, data: "", persisted: true, storagePath, sha256: uploadHash },
      checkpoints: {},
      stages: pipeline.steps.map((step) => ({ ...step, status: "pending" })),
      messages,
      error: "",
      failedStep: "",
      reanalysisInProgress: true,
      previousAnalysisSnapshot,
      previousReportArchive: archivedReport || ""
    });
    queueMicrotask(() => run(id).catch(() => {}));
    return publicJob(job);
  }

  async function deleteConversation(id, { ownerId } = {}) {
    await requireOwnedJob(id, ownerId);
    deletedIds.add(id);
    controllers.get(id)?.abort(new Error("对话已删除"));
    refreshControllers.get(id)?.abort(new Error("对话已删除"));
    const result = await repository.archiveConversation(id);
    publish(id, { type: "deleted", data: { id }, at: now() });
    return { id, uploadRetained: result.uploadRetained, pdfRetained: result.pdfRetained };
  }

  async function run(id) {
    if (deletedIds.has(id)) return;
    if (controllers.has(id)) return;
    let job = await requireJob(id);
    if (job.status === "queued") job = transitionReview(job, "running");
    else if (job.status !== "running") return;
    await repository.save(job);
    const controller = new AbortController();
    controllers.set(id, controller);
    publish(id, { type: "snapshot", data: publicJob(job), at: now() });
    try {
      const result = await pipelineFor(job).execute(job, {
        signal: controller.signal,
        onEvent: (event) => publish(id, event)
      });
      if (!result.ok) {
        const latest = await repository.get(id) || job;
        const bestReport = result.context?.report || await repository.getReport(id);
        const quality = result.context?.quality || latest.quality;
        const nextStatus = bestReport ? "needs_attention" : "failed";
        const failed = transitionReview({ ...latest, status: "running" }, nextStatus);
        await repository.save({
          ...failed,
          reportAvailable: Boolean(bestReport),
          error: result.error,
          failedStep: result.failedStep || ""
        });
        if (bestReport) await repository.saveReport(id, bestReport);
        publish(id, { type: "error", data: { message: result.error, failedStep: result.failedStep, report: bestReport, quality, status: nextStatus }, at: now() });
      }
    } finally {
      controllers.delete(id);
      if (deletedIds.has(id)) await repository.archiveConversation(id);
    }
  }

  async function refreshEvidence(id, { ownerId } = {}) {
    if (!evidenceRefreshService) throw new Error("公开资料刷新服务未启用");
    const existing = await requireOwnedJob(id, ownerId);
    if ([INDUSTRY_RESEARCH, PAPER_ANALYSIS].includes(taskTypeOf(existing))) throw new Error("该研究类型暂不支持公司公开资料刷新，请使用重新研究或继续追问");
    if (!["completed", "needs_attention"].includes(existing.status) || !existing.reportAvailable) {
      throw new Error(taskTypeOf(existing) === "company_pre_research" ? "请等待公司预研报告完成后再刷新公开资料" : "请等待 BP 核查报告完成后再刷新公开资料");
    }
    assertNoEvidenceRefresh(existing);
    const evidenceRefresh = evidenceRefreshService.createRefresh();
    const job = await repository.save({ ...existing, evidenceRefresh });
    queueMicrotask(() => runEvidenceRefresh(id).catch(() => {}));
    return publicJob(job);
  }

  async function runEvidenceRefresh(id) {
    if (!evidenceRefreshService || refreshControllers.has(id) || deletedIds.has(id)) return;
    const job = await requireJob(id);
    if (!["queued", "running"].includes(job.evidenceRefresh?.status)) return;
    const controller = new AbortController();
    refreshControllers.set(id, controller);
    publish(id, { type: "refresh_snapshot", data: { refresh: publicRefresh(job.evidenceRefresh), result: job.lastEvidenceRefresh || null }, at: now() });
    try {
      const result = await evidenceRefreshService.execute(job, {
        signal: controller.signal,
        onEvent: (event) => publish(id, event)
      });
      if (!result.ok) {
        publish(id, { type: "refresh_error", data: {
          message: result.error,
          failedStep: result.failedStep,
          refresh: publicRefresh(result.context?.job?.evidenceRefresh)
        }, at: now() });
      }
    } finally {
      refreshControllers.delete(id);
      if (deletedIds.has(id)) await repository.archiveConversation(id);
    }
  }

  async function get(id, { ownerId } = {}) {
    const job = await requireOwnedJob(id, ownerId);
    const storedReport = job.reportAvailable ? await repository.getReport(id) : "";
    const report = storedReport ? normalizeReviewReport(job, storedReport) : "";
    return { ...publicJob(job), report };
  }

  async function list({ ownerId, claimLegacy = true } = {}) {
    assertOwnerId(ownerId);
    if (claimLegacy && typeof repository.claimUnowned === "function") await repository.claimUnowned(ownerId);
    return (await repository.list({ ownerId })).map(publicJob);
  }

  async function ask(id, question, { onDelta, onStatus, onProgress, ownerId, signal } = {}) {
    const job = await requireOwnedJob(id, ownerId);
    const report = normalizeReviewReport(job, await repository.getReport(id));
    if (!report) throw new Error("报告尚未生成完成");
    const text = String(question || "").trim();
    if (!text) throw new Error("问题不能为空");
    const history = Array.isArray(job.messages) ? job.messages : [];
    let researchSources = [];
    let researchWarning = "";
    let researchPlan = { needsSearch: shouldUseWebSearch(text), tools: [], queries: buildWebSearchQueries(text), reason: "" };
    onProgress?.(followupProgress("research-plan", "判断检索需求", "running", "AI 正在判断现有报告是否足够回答"));
    if (typeof model.planFollowupResearch === "function") {
      onStatus?.("AI 正在判断现有数据是否足够回答…");
      try {
        researchPlan = await model.planFollowupResearch({ companyName: job.companyName, report, history, question: text, signal });
      } catch (error) {
        researchWarning = `检索规划降级：${error.message || error}`;
      }
    }
    onProgress?.(followupProgress("research-plan", "判断检索需求", "completed", researchPlan.needsSearch ? "需要补充公开资料" : "现有报告足够回答"));
    if (researchPlan.needsSearch && typeof model.webSearch === "function") {
      onProgress?.(followupProgress("agentic-search", "Agentic Search", "running", "正在准备检索公开资料"));
      onStatus?.(`AI 判断需要补充检索${researchPlan.reason ? `：${researchPlan.reason}` : ""}`);
      try {
        researchSources = await model.webSearch({
          companyName: job.companyName,
          queries: researchPlan.queries?.length ? researchPlan.queries : buildWebSearchQueries(text),
          requestedTools: researchPlan.tools || [],
          signal,
          onToolCall: (tool) => {
            onStatus?.(`Agentic Search 正在调用 ${tool.label} 工具…`);
            onProgress?.(followupProgress("agentic-search", "Agentic Search", "running", `正在调用 ${tool.label} 工具`));
          }
        });
      } catch (error) {
        researchWarning = `DeepSeek WebSearch 未返回结果：${error.message || error}`;
      }
      onProgress?.(followupProgress("agentic-search", "Agentic Search", "completed", researchWarning || `已整理 ${researchSources.length} 个公开来源`));
    } else {
      onProgress?.(followupProgress("agentic-search", "Agentic Search", "completed", "现有报告足够，无需额外检索"));
    }
    onProgress?.(followupProgress("answer-generation", "生成回答", "running", "正在结合报告与检索结果组织回答"));
    const answer = redactSensitiveText(await model.stream(buildFollowupMessages({
      companyName: job.companyName,
      taskType: taskTypeOf(job),
      report,
      history,
      question: text,
      researchSources,
      researchWarning,
      evidenceRefresh: job.lastEvidenceRefresh
    }), { signal, onDelta: (delta) => onDelta?.(redactSensitiveText(delta)), maxTokens: 4000 }));
    const messages = [
      ...history,
      { role: "user", content: text, at: now() },
      { role: "assistant", content: answer, at: now() }
    ].slice(-20);
    await repository.save({ ...job, messages });
    onProgress?.(followupProgress("answer-generation", "生成回答", "completed", "回答已生成并保存到当前对话"));
    return answer;
  }

  function subscribe(id, listener) {
    const listeners = subscribers.get(id) || new Set();
    listeners.add(listener);
    subscribers.set(id, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) subscribers.delete(id);
    };
  }

  function publish(id, event) {
    for (const listener of subscribers.get(id) || []) listener(event);
  }

  function pipelineFor(job) {
    if (taskTypeOf(job) === "company_pre_research") {
      if (!companyResearchPipeline) throw new Error("公司预研服务未启用");
      return companyResearchPipeline;
    }
    const specialPipeline = specialResearchTasks.pipelineFor(taskTypeOf(job));
    if (specialPipeline) return specialPipeline;
    return pipeline;
  }

  async function requireJob(id) {
    if (deletedIds.has(id)) throw Object.assign(new Error("未找到该核查任务"), { statusCode: 404 });
    const job = await repository.get(id);
    if (!job) throw Object.assign(new Error("未找到该核查任务"), { statusCode: 404 });
    return job;
  }

  async function requireOwnedJob(id, ownerId) {
    assertOwnerId(ownerId);
    let job = await requireJob(id);
    if (!job.ownerId) job = await repository.save({ ...job, ownerId });
    if (job.ownerId !== ownerId) {
      throw Object.assign(new Error("未找到该核查任务"), { statusCode: 404 });
    }
    return job;
  }

  return { ask, create, deleteConversation, get, list, reanalyze, refreshEvidence, replaceBp, retry, run, runEvidenceRefresh, subscribe };
}

function followupProgress(key, label, status, message) {
  return { key, label, status, message };
}

export function shouldUseWebSearch(question) {
  return /https?:\/\/|google\s*scholar|谷歌学术|检索|搜索|联网|公开资料|最新|引用量|clinicaltrials|\bNCT\d{8}\b|临床试验|药物管线|适应症/i.test(String(question || ""));
}

export function buildWebSearchQueries(question) {
  const text = String(question || "").trim();
  const urls = text.match(/https?:\/\/[^\s<>"'，。]+/g) || [];
  const queries = [...urls.slice(0, 2), text];
  return Array.from(new Set(queries)).slice(0, 3);
}

function publicJob(job) {
  const { upload, checkpoints, ownerId, previousReportArchive, previousAnalysisSnapshot, analysis, evidenceRefresh, ...safe } = job;
  return {
    ...safe,
    taskType: taskTypeOf(job),
    upload: upload ? { filename: upload.filename, mimeType: upload.mimeType, size: upload.size } : null,
    checkpointCount: Object.keys(checkpoints || {}).length,
    evidenceRefresh: publicRefresh(evidenceRefresh)
  };
}

function buildPreviousAnalysisSnapshot(job) {
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

function array(value) {
  return Array.isArray(value) ? value : [];
}

function recoverableRestartKey(job) {
  if (job.extractionWarning) return ({ company_pre_research: "fact-extraction", industry_research: "evidence-synthesis", paper_analysis: "metadata-extraction" })[taskTypeOf(job)] || "claim-extraction";
  if (job.investmentAnalysisWarning) return "investment-analysis";
  if (job.generationWarning) return "report-generation";
  return "";
}

function resetPipelineFrom(job, steps, restartKey) {
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

function assertNoEvidenceRefresh(job) {
  if (["queued", "running"].includes(job.evidenceRefresh?.status)) throw new Error("公开资料正在刷新，请完成后再执行其他核查操作");
}

function assertOwnerId(ownerId) {
  if (!ownerId) throw Object.assign(new Error("匿名浏览器身份无效"), { statusCode: 401 });
}

function normalizeInstruction(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeComparable(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}

function taskTypeOf(job) {
  if (["company_pre_research", INDUSTRY_RESEARCH, PAPER_ANALYSIS].includes(job?.taskType)) return job.taskType;
  return "attachment_review";
}
