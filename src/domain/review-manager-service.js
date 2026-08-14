import { createHash, randomUUID } from "node:crypto";
import { createReviewJob } from "./bp-review-pipeline.js";
import { createCompanyPreResearchJob } from "./company-pre-research-pipeline.js";
import { publicRefresh } from "./evidence-refresh-service.js";
import { buildFollowupMessages } from "./review-prompts.js";
import { normalizeReviewReport } from "./report-summary-service.js";
import { normalizeOutputLanguage } from "./report-language.js";
import { createSpecialResearchTaskService, INDUSTRY_RESEARCH, PAPER_ANALYSIS } from "./special-research-task-service.js";
import { transitionReview } from "./review-state-machine.js";
import { redactSensitiveText } from "../../public/privacy-redaction.js";
import { operationalError, safePipelineFailure } from "../infra/public-error.js";
import {
  array, assertNoEvidenceRefresh, assertOwnerId, buildPreviousAnalysisSnapshot,
  normalizeComparable, normalizeInstruction, publicJob, recoverableRestartKey,
  resetPipelineFrom, taskTypeOf
} from "./review-manager-support.js";

export function createReviewManagerService({ pipeline, companyResearchPipeline, industryResearchPipeline, paperAnalysisPipeline, repository, model, evidenceRefreshService, taskQueue = { run: (task) => task() }, maxActivePerOwner = 3, logger = {}, now = () => new Date().toISOString() }) {
  const subscribers = new Map();
  const controllers = new Map();
  const refreshControllers = new Map();
  const deletedIds = new Set();
  const pendingCreates = new Map();
  const capacityReservations = new Map();
  const specialResearchTasks = createSpecialResearchTaskService({
    repository,
    industryResearchPipeline,
    paperAnalysisPipeline,
    pendingCreates,
    now,
    beforeCreate: reserveOwnerCapacity,
    enqueue: enqueueRun
  });

  async function create({ taskType = "attachment_review", companyName, instruction, outputLanguage, upload, researchTemplate, sourceUrl }, { ownerId } = {}) {
    assertOwnerId(ownerId);
    outputLanguage = normalizeOutputLanguage(outputLanguage);
    if (taskType === "company_pre_research") return createCompanyResearch({ companyName, instruction, outputLanguage }, { ownerId });
    if (specialResearchTasks.handles(taskType)) {
      const job = await specialResearchTasks.create({ taskType, companyName, instruction, outputLanguage, upload, researchTemplate, sourceUrl }, { ownerId });
      await logger.audit?.("review.created", { jobId: job.id, ownerId, taskType: job.taskType });
      return publicJob(job);
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
    const release = await reserveOwnerCapacity(ownerId);
    try {
      const job = {
        ...createCompanyPreResearchJob({ companyName, instruction, outputLanguage, steps: companyResearchPipeline.steps, now }),
        ownerId
      };
      await repository.save(job);
      enqueueRun(job.id);
      await logger.audit?.("review.created", { jobId: job.id, ownerId, taskType: job.taskType });
      return publicJob(job);
    } finally {
      release();
    }
  }

  async function createOnce({ companyName, instruction, outputLanguage, upload, buffer, uploadHash }, { ownerId }) {
    const activeDuplicate = (await repository.list?.({ ownerId, limit: 100 }) || []).find((job) =>
      ["queued", "running"].includes(job.status)
      && job.upload?.sha256 === uploadHash
      && normalizeInstruction(job.instruction) === normalizeInstruction(instruction)
      && (job.outputLanguage || "zh") === (outputLanguage || "zh"));
    if (activeDuplicate) return publicJob(activeDuplicate);
    const release = await reserveOwnerCapacity(ownerId);
    try {
      let job = {
        ...createReviewJob({ companyName, instruction, outputLanguage, upload: { ...upload, sha256: uploadHash }, steps: pipeline.steps, now }),
        ownerId
      };
      if (typeof repository.saveUpload === "function") {
        const storagePath = await repository.saveUpload(job.id, buffer);
        job = { ...job, upload: { ...job.upload, data: "", persisted: true, storagePath } };
      }
      await repository.save(job);
      enqueueRun(job.id);
      await logger.audit?.("review.created", { jobId: job.id, ownerId, taskType: job.taskType });
      return publicJob(job);
    } finally {
      release();
    }
  }

  async function retry(id, { ownerId } = {}) {
    const existing = await requireOwnedJob(id, ownerId);
    assertNoEvidenceRefresh(existing);
    if (!new Set(["failed", "needs_attention"]).has(existing.status)) throw new Error("只有失败或需关注的任务可以重试");
    return withOwnerCapacity(ownerId, async () => {
      const selectedPipeline = pipelineFor(existing);
      const restartKey = recoverableRestartKey(existing);
      await repository.removePdf?.(id, existing.pdfStoragePath);
      const resumed = resetPipelineFrom(transitionReview(existing, "running"), selectedPipeline.steps, restartKey);
      const saved = await repository.save({ ...resumed, error: "", failedStep: "", pdfStoragePath: "" });
      enqueueRun(id);
      await logger.audit?.("review.retried", { jobId: id, ownerId });
      return publicJob(saved);
    });
  }

  async function reanalyze(id, { ownerId, outputLanguage } = {}) {
    const existing = await requireOwnedJob(id, ownerId);
    assertNoEvidenceRefresh(existing);
    if (existing.status === "running") throw new Error("任务正在运行，无需重复提交");
    return withOwnerCapacity(ownerId, async () => {
      const selectedPipeline = pipelineFor(existing);
      if (["attachment_review", PAPER_ANALYSIS].includes(taskTypeOf(existing)) && !existing.sourceUrl) {
        const upload = await repository.getUpload?.(id, existing.upload?.storagePath);
        if (!upload?.length) throw new Error("原始 BP 未保存，请重新上传文件发起核查");
      }
      const archivedReport = await repository.archiveReport?.(id);
      await repository.removePdf?.(id, existing.pdfStoragePath);
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
        previousReportArchive: archivedReport || "",
        pdfStoragePath: ""
      });
      enqueueRun(id);
      await logger.audit?.("review.reanalyzed", { jobId: id, ownerId });
      return publicJob(job);
    });
  }

  async function replaceBp(id, { instruction, outputLanguage, upload }, { ownerId } = {}) {
    const existing = await requireOwnedJob(id, ownerId);
    if (taskTypeOf(existing) !== "attachment_review") throw new Error("公司预研对话不支持替换 BP，请新建附件核查");
    assertNoEvidenceRefresh(existing);
    if (existing.status === "running") throw new Error("任务正在运行，请完成后再上传新版 BP");
    if (!upload?.data || !upload?.filename) throw new Error("请上传新版商业计划书");
    return withOwnerCapacity(ownerId, async () => {
      const buffer = Buffer.from(upload.data, "base64");
      const uploadHash = createHash("sha256").update(buffer).digest("hex");
      const storagePath = await repository.saveUpload(id, buffer);
      const archivedReport = await repository.archiveReport?.(id);
      await repository.removePdf?.(id, existing.pdfStoragePath);
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
        previousReportArchive: archivedReport || "",
        pdfStoragePath: ""
      });
      enqueueRun(id);
      await logger.audit?.("review.bp_replaced", { jobId: id, ownerId });
      return publicJob(job);
    });
  }

  async function deleteConversation(id, { ownerId } = {}) {
    await requireOwnedJob(id, ownerId);
    deletedIds.add(id);
    controllers.get(id)?.abort(new Error("对话已删除"));
    refreshControllers.get(id)?.abort(new Error("对话已删除"));
    const result = await repository.archiveConversation(id);
    await logger.audit?.("review.deleted", { jobId: id, ownerId });
    publish(id, { type: "deleted", data: { id }, at: now() });
    return { id, uploadRetained: result.uploadRetained, pdfRetained: result.pdfRetained };
  }

  async function failInterrupted(id, reason) {
    const job = await requireJob(id);
    if (!["queued", "running"].includes(job.status)) return publicJob(job);
    controllers.get(id)?.abort(new Error(reason));
    const nextStatus = job.status === "running" && job.reportAvailable ? "needs_attention" : "failed";
    const failed = transitionReview(job, nextStatus);
    const activeStage = array(job.stages).find((stage) => stage.status === "running");
    const saved = await repository.save({
      ...failed,
      error: String(reason || "任务在服务中断后未能恢复"),
      failedStep: activeStage?.key || job.failedStep || "startup-recovery",
      stages: array(job.stages).map((stage) => stage.status === "running"
        ? { ...stage, status: "failed", message: String(reason || "任务恢复超时") }
        : stage)
    });
    publish(id, { type: "error", data: { message: saved.error, failedStep: saved.failedStep, status: saved.status }, at: now() });
    return publicJob(saved);
  }

  function run(id) {
    return taskQueue.run(() => executeRun(id));
  }

  async function executeRun(id) {
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
        const publicFailure = safePipelineFailure();
        await logger.error?.("review.pipeline_failed", { jobId: id, error: result.cause || result.error, failedStep: result.failedStep });
        await repository.save({
          ...failed,
          reportAvailable: Boolean(bestReport),
          error: publicFailure,
          failedStep: result.failedStep || ""
        });
        if (bestReport) await repository.saveReport(id, bestReport);
        publish(id, { type: "error", data: { message: publicFailure, failedStep: result.failedStep, report: bestReport, quality, status: nextStatus }, at: now() });
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
    const release = await reserveOwnerCapacity(ownerId);
    try {
      const evidenceRefresh = evidenceRefreshService.createRefresh();
      const job = await repository.save({ ...existing, evidenceRefresh });
      queueMicrotask(() => runEvidenceRefresh(id).catch((error) => logger.error?.("review.refresh_failed", { jobId: id, error })));
      await logger.audit?.("review.evidence_refresh_started", { jobId: id, ownerId });
      return publicJob(job);
    } finally { release(); }
  }

  function runEvidenceRefresh(id) {
    return taskQueue.run(() => executeEvidenceRefresh(id));
  }

  async function executeEvidenceRefresh(id) {
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

  async function list({ ownerId } = {}) {
    assertOwnerId(ownerId);
    const jobs = typeof repository.listSummaries === "function" ? await repository.listSummaries({ ownerId }) : await repository.list({ ownerId });
    return jobs.map(publicJob);
  }

  async function ask(id, question, { onDelta, onStatus, onProgress, ownerId, signal } = {}) {
    const job = await requireOwnedJob(id, ownerId);
    const report = normalizeReviewReport(job, await repository.getReport(id));
    if (!report) throw new Error("报告尚未生成完成");
    const text = String(question || "").trim();
    if (!text) throw new Error("问题不能为空");
    const history = Array.isArray(job.messages) ? job.messages : [];
    const userMessage = { id: messageId(), role: "user", content: text, status: "complete", at: now() };
    await appendMessage(id, userMessage);
    let partialAnswer = "";
    let researchSources = [];
    let researchWarning = "";
    let researchPlan = { needsSearch: shouldUseWebSearch(text), tools: [], queries: buildWebSearchQueries(text), reason: "" };
    onProgress?.(followupProgress("research-plan", "判断检索需求", "running", "AI 正在判断现有报告是否足够回答"));
    if (typeof model.planFollowupResearch === "function") {
      onStatus?.("AI 正在判断现有数据是否足够回答…");
      try {
        researchPlan = await model.planFollowupResearch({ companyName: job.companyName, report, history, question: text, signal });
      } catch (error) {
        researchWarning = "检索规划暂时不可用，已使用本地规则继续判断";
        await logger.warn?.("review.followup_plan_degraded", { jobId: id, ownerId, error });
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
        researchWarning = "联网检索暂时不可用，回答将基于已有报告并明确资料限制";
        await logger.warn?.("review.followup_search_degraded", { jobId: id, ownerId, error });
      }
      onProgress?.(followupProgress("agentic-search", "Agentic Search", "completed", researchWarning || `已整理 ${researchSources.length} 个公开来源`));
    } else {
      onProgress?.(followupProgress("agentic-search", "Agentic Search", "completed", "现有报告足够，无需额外检索"));
    }
    onProgress?.(followupProgress("answer-generation", "生成回答", "running", "正在结合报告与检索结果组织回答"));
    try {
      const answer = redactSensitiveText(await model.stream(buildFollowupMessages({
        companyName: job.companyName,
        taskType: taskTypeOf(job),
        report,
        history,
        question: text,
        researchSources,
        researchWarning,
        evidenceRefresh: job.lastEvidenceRefresh
      }), { signal, onDelta: (delta) => {
        const safeDelta = redactSensitiveText(delta);
        partialAnswer += safeDelta;
        onDelta?.(safeDelta);
      }, maxTokens: 4000 }));
      await appendMessage(id, { id: messageId(), role: "assistant", content: answer, status: "complete", at: now() });
      await logger.audit?.("review.followup_completed", { jobId: id, ownerId });
      onProgress?.(followupProgress("answer-generation", "生成回答", "completed", "回答已生成并保存到当前对话"));
      return answer;
    } catch (error) {
      if (partialAnswer.trim()) {
        await appendMessage(id, { id: messageId(), role: "assistant", content: partialAnswer, status: "incomplete", at: now() });
      }
      await logger.warn?.("review.followup_interrupted", { jobId: id, ownerId, error });
      throw error;
    }
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
    const job = await requireJob(id);
    if (job.ownerId !== ownerId) {
      throw Object.assign(new Error("未找到该核查任务"), { statusCode: 404 });
    }
    return job;
  }

  async function reserveOwnerCapacity(ownerId) {
    const jobs = await repository.list?.({ ownerId, limit: 10000 }) || [];
    const active = jobs.filter((job) => ["queued", "running"].includes(job.status) || ["queued", "running"].includes(job.evidenceRefresh?.status)).length;
    const reserved = capacityReservations.get(ownerId) || 0;
    if (active + reserved >= maxActivePerOwner) {
      throw operationalError(`同时运行的研究任务不能超过 ${maxActivePerOwner} 个`, { statusCode: 429, code: "active_task_limit" });
    }
    capacityReservations.set(ownerId, reserved + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = (capacityReservations.get(ownerId) || 1) - 1;
      if (next > 0) capacityReservations.set(ownerId, next);
      else capacityReservations.delete(ownerId);
    };
  }

  async function withOwnerCapacity(ownerId, operation) {
    const release = await reserveOwnerCapacity(ownerId);
    try { return await operation(); } finally { release(); }
  }

  async function appendMessage(id, message) {
    const latest = await requireJob(id);
    const messages = [...array(latest.messages).filter((item) => item.id !== message.id), message].slice(-20);
    await repository.save({ ...latest, messages });
  }

  function enqueueRun(id) {
    queueMicrotask(() => run(id).catch((error) => logger.error?.("review.run_unhandled", { jobId: id, error })));
  }

  return { ask, create, deleteConversation, failInterrupted, get, list, reanalyze, refreshEvidence, replaceBp, retry, run, runEvidenceRefresh, subscribe };
}

function followupProgress(key, label, status, message) { return { key, label, status, message }; }

function messageId() { return `msg_${randomUUID().replace(/-/g, "").slice(0, 20)}`; }

export function shouldUseWebSearch(question) {
  return /https?:\/\/|google\s*scholar|谷歌学术|检索|搜索|联网|公开资料|最新|引用量|clinicaltrials|\bNCT\d{8}\b|临床试验|药物管线|适应症/i.test(String(question || ""));
}

export function buildWebSearchQueries(question) {
  const text = String(question || "").trim();
  const urls = text.match(/https?:\/\/[^\s<>"'，。]+/g) || [];
  const queries = [...urls.slice(0, 2), text];
  return Array.from(new Set(queries)).slice(0, 3);
}
