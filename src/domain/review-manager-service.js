import { createHash, randomUUID } from "node:crypto";
import { createReviewJob } from "./bp-review-pipeline.js";
import { createCompanyPreResearchJob } from "./company-pre-research-pipeline.js";
import { publicRefresh } from "./evidence-refresh-service.js";
import { buildFollowupMessages } from "./review-prompts.js";
import { normalizeReviewReport } from "./report-summary-service.js";
import { normalizeOutputLanguage } from "./report-language.js";
import { createSpecialResearchTaskService, INDUSTRY_RESEARCH, PAPER_ANALYSIS } from "./special-research-task-service.js";
import { createReviewCancellationService, resumedJob } from "./review-cancellation-service.js";
import { createOwnerCapacityGuard } from "./review-owner-capacity.js";
import { createEnqueueFailureHandler } from "./review-enqueue-failure.js";
import { buildWebSearchQueries, shouldUseWebSearch } from "./followup-research-plan.js";
import { transitionReview } from "./review-state-machine.js";
import { forkSharedReview } from "./review-share-state.js";
import { redactSensitiveText } from "../../public/privacy-redaction.js";
import { operationalError, safePipelineFailure } from "../infra/public-error.js";
import { persistReviewUploadSet, prepareReviewUploadSet } from "./review-upload-set.js";
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
  const capacity = createOwnerCapacityGuard({ repository, taskQueue, maxActivePerOwner });
  const enqueueFailure = createEnqueueFailureHandler({ repository, publish, logger, now });
  const cancellation = createReviewCancellationService({ repository, controllers, requireOwnedJob, publish, logger, now });
  const specialResearchTasks = createSpecialResearchTaskService({
    repository,
    industryResearchPipeline,
    paperAnalysisPipeline,
    pendingCreates,
    now,
    beforeCreate: capacity.admit,
    enqueue: enqueueRun
  });

  async function create({ taskType = "attachment_review", companyName, instruction, outputLanguage, upload, uploads, researchTemplate, sourceUrl }, { ownerId } = {}) {
    assertOwnerId(ownerId);
    outputLanguage = normalizeOutputLanguage(outputLanguage);
    if (taskType === "company_pre_research") return createCompanyResearch({ companyName, instruction, outputLanguage }, { ownerId });
    if (specialResearchTasks.handles(taskType)) {
      const job = await specialResearchTasks.create({ taskType, companyName, instruction, outputLanguage, upload, researchTemplate, sourceUrl }, { ownerId });
      await logger.audit?.("review.created", { jobId: job.id, ownerId, taskType: job.taskType });
      return publicJob(job);
    }
    const uploadSet = prepareReviewUploadSet({ upload, uploads });
    const createKey = `${ownerId}:${uploadSet.hash}:${normalizeInstruction(instruction)}`;
    if (pendingCreates.has(createKey)) return pendingCreates.get(createKey);
    const promise = createOnce({ companyName, instruction, outputLanguage, uploadSet }, { ownerId })
      .finally(() => pendingCreates.delete(createKey));
    pendingCreates.set(createKey, promise);
    return promise;
  }

  async function createCompanyResearch({ companyName, instruction, outputLanguage }, { ownerId }) {
    if (!companyResearchPipeline) throw operationalError("公司预研服务未启用", { statusCode: 503, code: "company_research_disabled" });
    const name = String(companyName || "").replace(/\s+/g, " ").trim();
    if (!name) throw operationalError("公司预研需要填写公司名称", { statusCode: 400, code: "company_name_required" });
    const researchInstruction = normalizeInstruction(instruction) || "基于公开信息完成公司预研";
    const createKey = `${ownerId}:company_pre_research:${name.toLowerCase()}:${researchInstruction}:${outputLanguage || "zh"}`;
    if (pendingCreates.has(createKey)) return pendingCreates.get(createKey);
    const promise = createCompanyResearchOnce({ companyName: name, instruction: researchInstruction, outputLanguage }, { ownerId })
      .finally(() => pendingCreates.delete(createKey));
    pendingCreates.set(createKey, promise);
    return promise;
  }

  // 准入 = owner 活动额度 + 一个排队位。两者都必须在任务落盘之前拿到：
  // 队列位若等到入队时才判定，被拒的任务已经保存，会变成不执行也不通知的僵尸任务。
  async function createCompanyResearchOnce({ companyName, instruction, outputLanguage }, { ownerId }) {
    const activeDuplicate = (await capacity.summaries(ownerId, 100)).find((job) =>
      job.taskType === "company_pre_research"
      && ["queued", "running"].includes(job.status)
      && normalizeComparable(job.companyName) === normalizeComparable(companyName)
      && normalizeInstruction(job.instruction) === normalizeInstruction(instruction)
      && (job.outputLanguage || "zh") === (outputLanguage || "zh"));
    if (activeDuplicate) return publicJob(await capacity.hydrate(activeDuplicate));
    return capacity.withAdmission(ownerId, async ({ release, useSlot }) => {
      const job = {
        ...createCompanyPreResearchJob({ companyName, instruction, outputLanguage, steps: companyResearchPipeline.steps, now }),
        ownerId
      };
      await repository.save(job);
      release();
      enqueueRun(job.id, ownerId, useSlot());
      await logger.audit?.("review.created", { jobId: job.id, ownerId, taskType: job.taskType });
      return publicJob(job);
    });
  }

  async function createOnce({ companyName, instruction, outputLanguage, uploadSet }, { ownerId }) {
    const activeDuplicate = (await capacity.summaries(ownerId, 100)).find((job) =>
      ["queued", "running"].includes(job.status)
      && (job.uploadSetHash || job.upload?.sha256) === uploadSet.hash
      && normalizeInstruction(job.instruction) === normalizeInstruction(instruction)
      && (job.outputLanguage || "zh") === (outputLanguage || "zh"));
    if (activeDuplicate) return publicJob(await capacity.hydrate(activeDuplicate));
    return capacity.withAdmission(ownerId, async ({ release, useSlot }) => {
      let job = {
        ...createReviewJob({ companyName, instruction, outputLanguage, upload: uploadSet.entries[0].upload, uploads: uploadSet.entries.map((entry) => entry.upload), uploadSetHash: uploadSet.hash, steps: pipeline.steps, now }),
        ownerId
      };
      const persisted = await persistReviewUploadSet({ repository, jobId: job.id, entries: uploadSet.entries });
      job = { ...job, upload: persisted[0], uploads: persisted };
      await repository.save(job);
      release();
      enqueueRun(job.id, ownerId, useSlot());
      await logger.audit?.("review.created", { jobId: job.id, ownerId, taskType: job.taskType });
      return publicJob(job);
    });
  }

  async function retry(id, { ownerId } = {}) {
    let existing = await requireOwnedJob(id, ownerId);
    if (existing.status === "cancelled") {
      await cancellation.waitForSettled(id);
      existing = await requireOwnedJob(id, ownerId);
    }
    assertNoEvidenceRefresh(existing);
    if (!new Set(["failed", "needs_attention", "cancelled"]).has(existing.status)) throw operationalError("只有失败、需关注或已停止的任务可以重试", { statusCode: 409, code: "retry_not_allowed" });
    return capacity.withAdmission(ownerId, async ({ release, useSlot }) => {
      const selectedPipeline = pipelineFor(existing);
      const restartKey = recoverableRestartKey(existing);
      await repository.removePdf?.(id, existing.pdfStoragePath);
      const resumed = resumedJob(resetPipelineFrom(transitionReview(forkSharedReview(existing, "retry", now()), "running"), selectedPipeline.steps, restartKey));
      const saved = await repository.save({ ...resumed, error: "", failedStep: "", pdfStoragePath: "" });
      release();
      enqueueRun(id, ownerId, useSlot());
      await logger.audit?.("review.retried", { jobId: id, ownerId });
      return publicJob(saved);
    });
  }

  async function reanalyze(id, { ownerId, outputLanguage } = {}) {
    const existing = await requireOwnedJob(id, ownerId);
    cancellation.assertSettled(id);
    assertNoEvidenceRefresh(existing);
    if (existing.status === "running") throw operationalError("任务正在运行，无需重复提交", { statusCode: 409, code: "task_already_running" });
    return capacity.withAdmission(ownerId, async ({ release, useSlot }) => {
      const selectedPipeline = pipelineFor(existing);
      if (["attachment_review", PAPER_ANALYSIS].includes(taskTypeOf(existing)) && !existing.sourceUrl) {
        const upload = await repository.getUpload?.(id, existing.upload?.storagePath);
        if (!upload?.length) throw operationalError("原始 BP 未保存，请重新上传文件发起核查", { statusCode: 409, code: "source_upload_missing" });
      }
      const archivedReport = await repository.archiveReport?.(id);
      await repository.removePdf?.(id, existing.pdfStoragePath);
      const resumed = transitionReview(forkSharedReview(existing, "reanalyze", now()), "running");
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
      release();
      enqueueRun(id, ownerId, useSlot());
      await logger.audit?.("review.reanalyzed", { jobId: id, ownerId });
      return publicJob(job);
    });
  }

  async function replaceBp(id, { instruction, outputLanguage, upload }, { ownerId } = {}) {
    const existing = await requireOwnedJob(id, ownerId);
    cancellation.assertSettled(id);
    if (taskTypeOf(existing) !== "attachment_review") throw operationalError("公司预研对话不支持替换 BP，请新建附件核查", { statusCode: 400, code: "replace_bp_unsupported" });
    assertNoEvidenceRefresh(existing);
    if (existing.status === "running") throw operationalError("任务正在运行，请完成后再上传新版 BP", { statusCode: 409, code: "task_already_running" });
    if (!upload?.data || !upload?.filename) throw operationalError("请上传新版商业计划书", { statusCode: 400, code: "upload_required" });
    return capacity.withAdmission(ownerId, async ({ release, useSlot }) => {
      const buffer = Buffer.from(upload.data, "base64");
      const uploadHash = createHash("sha256").update(buffer).digest("hex");
      const storagePath = await repository.saveUpload(id, buffer);
      const archivedReport = await repository.archiveReport?.(id);
      await repository.removePdf?.(id, existing.pdfStoragePath);
      const previousAnalysisSnapshot = buildPreviousAnalysisSnapshot(existing);
      const resumed = transitionReview(forkSharedReview(existing, "replace_bp", now()), "running");
      const messages = [
        ...(existing.messages || []),
        { role: "user", content: `上传同一公司的新版 BP：${upload.filename}${instruction ? `\n${instruction}` : ""}`, at: now() }
      ].slice(-20);
      const job = await repository.save({
        ...resumed,
        instruction: String(instruction || existing.instruction || "全面核查这份 BP").trim(),
        outputLanguage: outputLanguage ? normalizeOutputLanguage(outputLanguage) : existing.outputLanguage || "zh",
        upload: { filename: upload.filename, mimeType: upload.mimeType, size: upload.size, data: "", persisted: true, storagePath, sha256: uploadHash },
        uploads: [{ filename: upload.filename, mimeType: upload.mimeType, size: upload.size, data: "", persisted: true, storagePath, sha256: uploadHash }],
        uploadSetHash: uploadHash,
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
      release();
      enqueueRun(id, ownerId, useSlot());
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

  // admitted 默认为 true：manager.run 的外部调用方（启动恢复）处理的是此前已经
  // 准入过的任务，不该再受排队上限拦截；新提交走 enqueueRun 并携带预占的队列位。
  function run(id, ownerId = "", { admitted = true, onStart } = {}) {
    return taskQueue.run(() => { onStart?.(); return executeRun(id); }, { key: ownerId, admitted });
  }

  async function executeRun(id) {
    if (deletedIds.has(id)) return;
    if (controllers.has(id)) return;
    let job = await requireJob(id);
    if (job.status === "queued") job = transitionReview(job, "running");
    else if (job.status !== "running") return;
    const controller = new AbortController();
    controllers.set(id, controller);
    try {
      await repository.save(job);
      publish(id, { type: "snapshot", data: publicJob(job), at: now() });
      const result = await pipelineFor(job).execute(job, {
        signal: controller.signal,
        onEvent: (event) => publish(id, event)
      });
      if (!result.ok) {
        const latest = await repository.get(id) || job;
        if (cancellation.isStopping(id)) return;
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
      await cancellation.settle(id);
      if (deletedIds.has(id)) await repository.archiveConversation(id);
    }
  }

  async function refreshEvidence(id, { ownerId } = {}) {
    if (!evidenceRefreshService) throw operationalError("公开资料刷新服务未启用", { statusCode: 503, code: "evidence_refresh_disabled" });
    const existing = await requireOwnedJob(id, ownerId);
    if ([INDUSTRY_RESEARCH, PAPER_ANALYSIS].includes(taskTypeOf(existing))) throw operationalError("该研究类型暂不支持公司公开资料刷新，请使用重新研究或继续追问", { statusCode: 400, code: "evidence_refresh_unsupported" });
    if (!["completed", "needs_attention"].includes(existing.status) || !existing.reportAvailable) {
      throw operationalError(taskTypeOf(existing) === "company_pre_research" ? "请等待公司预研报告完成后再刷新公开资料" : "请等待 BP 核查报告完成后再刷新公开资料", { statusCode: 409, code: "report_not_ready" });
    }
    assertNoEvidenceRefresh(existing);
    return capacity.withAdmission(ownerId, async ({ release, useSlot }) => {
      const evidenceRefresh = evidenceRefreshService.createRefresh();
      const job = await repository.save({ ...forkSharedReview(existing, "evidence_refresh", now()), evidenceRefresh });
      release();
      enqueueEvidenceRefresh(id, ownerId, useSlot());
      await logger.audit?.("review.evidence_refresh_started", { jobId: id, ownerId });
      return publicJob(job);
    });
  }

  function runEvidenceRefresh(id, ownerId = "", { admitted = true, onStart } = {}) {
    return taskQueue.run(() => { onStart?.(); return executeEvidenceRefresh(id); }, { key: ownerId, admitted });
  }

  function enqueueEvidenceRefresh(id, ownerId, slot) {
    queueMicrotask(() => {
      let started = false;
      slot?.();
      runEvidenceRefresh(id, ownerId, { admitted: Boolean(slot), onStart: () => { started = true; } })
        .catch((error) => enqueueFailure.failRefresh(id, ownerId, error, { started }));
    });
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
    if (!report) throw operationalError("报告尚未生成完成", { statusCode: 409, code: "report_not_ready" });
    const text = String(question || "").trim();
    if (!text) throw operationalError("问题不能为空", { statusCode: 400, code: "question_required" });
    const history = Array.isArray(job.messages) ? job.messages : [];
    const userMessage = { id: messageId(), role: "user", content: text, status: "complete", at: now() };
    await appendMessage(id, userMessage, { forkReason: "followup" });
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
      if (!companyResearchPipeline) throw operationalError("公司预研服务未启用", { statusCode: 503, code: "company_research_disabled" });
      return companyResearchPipeline;
    }
    const specialPipeline = specialResearchTasks.pipelineFor(taskTypeOf(job));
    if (specialPipeline) return specialPipeline;
    return pipeline;
  }

  async function requireJob(id) {
    if (deletedIds.has(id)) throw operationalError("未找到该核查任务", { statusCode: 404, code: "review_not_found" });
    const job = await repository.get(id);
    if (!job) throw operationalError("未找到该核查任务", { statusCode: 404, code: "review_not_found" });
    return job;
  }

  async function requireOwnedJob(id, ownerId) {
    assertOwnerId(ownerId);
    const job = await requireJob(id);
    if (job.ownerId !== ownerId) {
      throw operationalError("未找到该核查任务", { statusCode: 404, code: "review_not_found" });
    }
    return job;
  }

  async function appendMessage(id, message, { forkReason = "" } = {}) {
    const latest = await requireJob(id);
    const messages = [...array(latest.messages).filter((item) => item.id !== message.id), message].slice(-20);
    const review = forkReason ? forkSharedReview(latest, forkReason, now()) : latest;
    await repository.save({ ...review, messages });
  }

  function enqueueRun(id, ownerId = "", slot = null) {
    queueMicrotask(() => {
      let started = false;
      slot?.();
      run(id, ownerId, { admitted: Boolean(slot), onStart: () => { started = true; } })
        .catch((error) => enqueueFailure.failReview(id, ownerId, error, { started }));
    });
  }

  return { ask, cancel: cancellation.cancel, create, deleteConversation, failInterrupted, get, list, reanalyze, refreshEvidence, replaceBp, retry, run, runEvidenceRefresh, subscribe };
}
function followupProgress(key, label, status, message) { return { key, label, status, message }; }

function messageId() { return `msg_${randomUUID().replace(/-/g, "").slice(0, 20)}`; }
