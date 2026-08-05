import { createHash } from "node:crypto";
import { createReviewJob } from "./bp-review-pipeline.js";
import { buildFollowupMessages } from "./review-prompts.js";
import { transitionReview } from "./review-state-machine.js";
import { redactSensitiveText } from "../../public/privacy-redaction.js";

export function createReviewManagerService({ pipeline, repository, model, now = () => new Date().toISOString() }) {
  const subscribers = new Map();
  const controllers = new Map();
  const deletedIds = new Set();
  const pendingCreates = new Map();

  async function create({ companyName, instruction, upload }, { ownerId } = {}) {
    assertOwnerId(ownerId);
    if (!upload?.data || !upload?.filename) throw new Error("请先上传商业计划书");
    const buffer = Buffer.from(upload.data, "base64");
    const uploadHash = createHash("sha256").update(buffer).digest("hex");
    const createKey = `${ownerId}:${uploadHash}:${normalizeInstruction(instruction)}`;
    if (pendingCreates.has(createKey)) return pendingCreates.get(createKey);
    const promise = createOnce({ companyName, instruction, upload, buffer, uploadHash }, { ownerId })
      .finally(() => pendingCreates.delete(createKey));
    pendingCreates.set(createKey, promise);
    return promise;
  }

  async function createOnce({ companyName, instruction, upload, buffer, uploadHash }, { ownerId }) {
    const activeDuplicate = (await repository.list?.({ ownerId, limit: 100 }) || []).find((job) =>
      ["queued", "running"].includes(job.status)
      && job.upload?.sha256 === uploadHash
      && normalizeInstruction(job.instruction) === normalizeInstruction(instruction));
    if (activeDuplicate) return publicJob(activeDuplicate);
    let job = {
      ...createReviewJob({ companyName, instruction, upload: { ...upload, sha256: uploadHash }, steps: pipeline.steps, now }),
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
    if (!new Set(["failed", "needs_attention"]).has(existing.status)) throw new Error("只有失败或需关注的任务可以重试");
    const resumed = transitionReview(existing, "running");
    await repository.save({ ...resumed, error: "", failedStep: "" });
    queueMicrotask(() => run(id).catch(() => {}));
    return publicJob(resumed);
  }

  async function reanalyze(id, { ownerId } = {}) {
    const existing = await requireOwnedJob(id, ownerId);
    if (existing.status === "running") throw new Error("任务正在运行，无需重复提交");
    const upload = await repository.getUpload?.(id, existing.upload?.storagePath);
    if (!upload?.length) throw new Error("原始 BP 未保存，请重新上传文件发起核查");
    const archivedReport = await repository.archiveReport?.(id);
    const resumed = transitionReview(existing, "running");
    const job = await repository.save({
      ...resumed,
      checkpoints: {},
      stages: pipeline.steps.map((step) => ({ ...step, status: "pending" })),
      error: "",
      failedStep: "",
      reanalysisInProgress: true,
      previousReportArchive: archivedReport || ""
    });
    queueMicrotask(() => run(id).catch(() => {}));
    return publicJob(job);
  }

  async function replaceBp(id, { instruction, upload }, { ownerId } = {}) {
    const existing = await requireOwnedJob(id, ownerId);
    if (existing.status === "running") throw new Error("任务正在运行，请完成后再上传新版 BP");
    if (!upload?.data || !upload?.filename) throw new Error("请上传新版商业计划书");
    const buffer = Buffer.from(upload.data, "base64");
    const uploadHash = createHash("sha256").update(buffer).digest("hex");
    const storagePath = await repository.saveUpload(id, buffer);
    const archivedReport = await repository.archiveReport?.(id);
    const resumed = transitionReview(existing, "running");
    const messages = [
      ...(existing.messages || []),
      { role: "user", content: `上传同一公司的新版 BP：${upload.filename}${instruction ? `\n${instruction}` : ""}`, at: now() }
    ].slice(-20);
    const job = await repository.save({
      ...resumed,
      instruction: String(instruction || existing.instruction || "全面核查这份 BP").trim(),
      upload: { filename: upload.filename, mimeType: upload.mimeType, size: upload.size, data: "", persisted: true, storagePath, sha256: uploadHash },
      checkpoints: {},
      stages: pipeline.steps.map((step) => ({ ...step, status: "pending" })),
      messages,
      error: "",
      failedStep: "",
      reanalysisInProgress: true,
      previousReportArchive: archivedReport || ""
    });
    queueMicrotask(() => run(id).catch(() => {}));
    return publicJob(job);
  }

  async function deleteConversation(id, { ownerId } = {}) {
    await requireOwnedJob(id, ownerId);
    deletedIds.add(id);
    controllers.get(id)?.abort(new Error("对话已删除"));
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
      const result = await pipeline.execute(job, {
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

  async function get(id, { ownerId } = {}) {
    const job = await requireOwnedJob(id, ownerId);
    const report = job.reportAvailable ? await repository.getReport(id) : "";
    return { ...publicJob(job), report };
  }

  async function list({ ownerId, claimLegacy = true } = {}) {
    assertOwnerId(ownerId);
    if (claimLegacy && typeof repository.claimUnowned === "function") await repository.claimUnowned(ownerId);
    return (await repository.list({ ownerId })).map(publicJob);
  }

  async function ask(id, question, { onDelta, onStatus, onProgress, ownerId, signal } = {}) {
    const job = await requireOwnedJob(id, ownerId);
    const report = await repository.getReport(id);
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
      report,
      history,
      question: text,
      researchSources,
      researchWarning
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

  return { ask, create, deleteConversation, get, list, reanalyze, replaceBp, retry, run, subscribe };
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
  const { upload, checkpoints, ownerId, previousReportArchive, ...safe } = job;
  return {
    ...safe,
    upload: upload ? { filename: upload.filename, mimeType: upload.mimeType, size: upload.size } : null,
    checkpointCount: Object.keys(checkpoints || {}).length
  };
}

function assertOwnerId(ownerId) {
  if (!ownerId) throw Object.assign(new Error("匿名浏览器身份无效"), { statusCode: 401 });
}

function normalizeInstruction(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
