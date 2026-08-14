import http from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile, getRuntimeConfig } from "./src/config/runtime-config.js";
import { createBpReviewPipeline } from "./src/domain/bp-review-pipeline.js";
import { createCompanyPreResearchPipeline } from "./src/domain/company-pre-research-pipeline.js";
import { createCompanyIdentityService } from "./src/domain/company-identity-service.js";
import { createComparableCompanyResearchToolService } from "./src/domain/comparable-company-research-tool-service.js";
import { buildConversationExport } from "./src/domain/conversation-export-service.js";
import { createEvidenceRefreshService } from "./src/domain/evidence-refresh-service.js";
import { createIndustryResearchPipeline } from "./src/domain/industry-research-pipeline.js";
import { createInvestmentAnalysisService } from "./src/domain/investment-analysis-service.js";
import { createLazyPdfService } from "./src/domain/lazy-pdf-service.js";
import { createPaperAnalysisPipeline } from "./src/domain/paper-analysis-pipeline.js";
import { createReviewManagerService } from "./src/domain/review-manager-service.js";
import { createSemanticOverclaimService } from "./src/domain/semantic-overclaim-service.js";
import { createTechnologyResearchToolService } from "./src/domain/technology-research-tool-service.js";
import { recoverActiveReviews } from "./src/domain/startup-recovery-service.js";
import { createDeepSeekModelService } from "./src/infra/deepseek-model-service.js";
import { createBrowserSessionService } from "./src/infra/browser-session-service.js";
import { createBoundedTaskQueue } from "./src/infra/bounded-task-queue.js";
import { createDocumentExtractionService } from "./src/infra/document-extraction-service.js";
import { createEvidenceVerificationService } from "./src/infra/evidence-verification-service.js";
import { createGoogleAuthService } from "./src/infra/google-auth-service.js";
import { createLinkedPageResearchService } from "./src/infra/linked-page-research-service.js";
import { createPdfReportService } from "./src/infra/pdf-report-service.js";
import { createPdfWorkerExtractionService } from "./src/infra/pdf-worker-extraction-service.js";
import { createJsonlLogger } from "./src/infra/jsonl-logger.js";
import { acquireProcessLease } from "./src/infra/process-lease.js";
import { publicError } from "./src/infra/public-error.js";
import { createPublicAssetService } from "./src/infra/public-asset-service.js";
import { createRateLimiter, requestClientKey } from "./src/infra/rate-limiter.js";
import { createStructuredResearchToolService } from "./src/infra/research-tools/structured-research-tool-service.js";
import { sanitizeVisibleFilename } from "./public/privacy-redaction.js";
import { createFileReviewRepository } from "./src/storage/file-review-repository.js";
import { createFileUsageBudget } from "./src/storage/file-usage-budget.js";
import { createDataRetentionService } from "./src/storage/data-retention-service.js";

loadEnvFile();
const config = getRuntimeConfig();
const processLease = await acquireProcessLease({ dataDir: config.dataDir });
const logger = createJsonlLogger({ dataDir: config.dataDir });
const repository = createFileReviewRepository({ dataDir: config.dataDir });
await repository.initialize();
const researchTools = createStructuredResearchToolService({ credentials: config.researchTools });
const pdfExtractionQueue = createBoundedTaskQueue({ concurrency: config.documents.pdfConcurrency });
const pdfExtractor = createPdfWorkerExtractionService({ timeoutMs: config.documents.pdfTimeoutMs, queue: pdfExtractionQueue });
const extractor = createDocumentExtractionService({ maxBytes: config.maxUploadBytes, pdfExtractor });
const linkedPageResearch = createLinkedPageResearchService({ documentExtractor: extractor });
const model = createDeepSeekModelService({ config: config.model, researchTools, linkedPageResearch });
const technologyResearchTool = createTechnologyResearchToolService({ model, webResearchEnabled: config.webResearchEnabled });
const comparableCompanyResearchTool = createComparableCompanyResearchToolService({ model, webResearchEnabled: config.webResearchEnabled });
const companyIdentity = createCompanyIdentityService({ extractor, model });
const investmentAnalysis = createInvestmentAnalysisService({ model });
const evidenceVerification = createEvidenceVerificationService();
const evidenceRefresh = createEvidenceRefreshService({ model, repository });
const semanticQuality = createSemanticOverclaimService({ model, enabled: config.semanticQualityCheckEnabled });
const pdf = createPdfReportService();
const researchTaskQueue = createBoundedTaskQueue({ concurrency: config.jobs.globalConcurrency });
const pipeline = createBpReviewPipeline({ extractor, model, repository, pdfReportService: pdf, investmentAnalysisService: investmentAnalysis, evidenceVerificationService: evidenceVerification, semanticQualityService: semanticQuality, technologyResearchTool, comparableCompanyResearchTool, webResearchEnabled: config.webResearchEnabled });
const companyResearchPipeline = createCompanyPreResearchPipeline({ model, repository, pdfReportService: pdf, technologyResearchTool, comparableCompanyResearchTool, webResearchEnabled: config.webResearchEnabled });
const industryResearchPipeline = createIndustryResearchPipeline({ model, repository, pdfReportService: pdf, webResearchEnabled: config.webResearchEnabled });
const paperSourceFetcher = createLinkedPageResearchService({ documentExtractor: extractor, limits: { maxPdfBytes: config.maxUploadBytes, timeoutMs: 20000 } });
const paperAnalysisPipeline = createPaperAnalysisPipeline({ extractor, model, repository, paperSourceFetcher, pdfReportService: pdf, webResearchEnabled: config.webResearchEnabled });
const manager = createReviewManagerService({
  pipeline, companyResearchPipeline, industryResearchPipeline, paperAnalysisPipeline, repository, model,
  evidenceRefreshService: evidenceRefresh, taskQueue: researchTaskQueue, maxActivePerOwner: config.jobs.maxActivePerOwner, logger
});
const browserSessions = createBrowserSessionService();
const googleAuth = createGoogleAuthService({ config: config.auth.google });
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const publicAssets = await createPublicAssetService({ publicDir, useManifest: config.production });
const generalRateLimiter = createRateLimiter({ windowMs: config.security.requestWindowMs, max: config.security.requestLimit });
const expensiveRateLimiter = createRateLimiter({ windowMs: config.security.requestWindowMs, max: config.security.expensiveRequestLimit });
const usageBudget = createFileUsageBudget({ dataDir: config.dataDir, ownerDailyLimit: config.security.ownerDailyCostUnits, globalDailyLimit: config.security.globalDailyCostUnits });
const retention = createDataRetentionService({ dataDir: config.dataDir, repository, retentionDays: config.retention.days, graceDays: config.retention.graceDays, logger });
const lazyPdf = createLazyPdfService({ repository, pdf, titleFor: reportTitle });
const retentionTimer = setInterval(() => {
  void retention.cleanup().catch((error) => logger.error("retention.cleanup_failed", { error }));
}, 24 * 60 * 60 * 1000);
retentionTimer.unref();

const server = http.createServer(async (req, res) => {
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  try {
    await route(req, res);
  } catch (error) {
    if (res.headersSent) return res.end();
    const failure = publicError(error, { requestId: req.requestId });
    if (failure.status < 500 && req.usageReceipt) await usageBudget.refund(req.usageReceipt);
    await logger.error("http.request_failed", { requestId: req.requestId, method: req.method, path: req.url, error });
    if (error.retryAfterSeconds) res.setHeader("Retry-After", error.retryAfterSeconds);
    json(res, failure.status, failure.body);
  }
});

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const browserSession = browserSessions.resolve(req, res);
  const authenticatedSession = googleAuth.resolve(req);
  const ownerId = authenticatedSession?.ownerId || browserSession.id;
  const clientKey = requestClientKey(req, { trustProxy: config.security.trustProxy });
  if (url.pathname !== "/api/health") {
    generalRateLimiter.consume(clientKey);
  }
  if (req.method === "GET" && url.pathname === "/api/auth/session") {
    return json(res, 200, { ok: true, ...googleAuth.status(req) });
  }
  if (req.method === "GET" && url.pathname === "/auth/google") return googleAuth.begin(req, res, url);
  if (req.method === "GET" && url.pathname === "/auth/google/callback") {
    const session = await googleAuth.complete(req, res, url);
    await repository.transferOwnership(browserSession.id, session.ownerId);
    await logger.audit("auth.google_completed", { ownerId: session.ownerId });
    return redirect(res, session.returnTo);
  }
  if (req.method === "POST" && url.pathname === "/auth/logout") {
    googleAuth.logout(req, res);
    await logger.audit("auth.logged_out", { ownerId });
    return json(res, 200, { ok: true });
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, {
      ok: true,
      model: config.model.model,
      modelConfigured: Boolean(config.model.apiKey),
      modelCredentialSource: config.model.credentialSource,
      googleAuthEnabled: googleAuth.enabled,
      googleAuthRequired: googleAuth.required,
      webResearchEnabled: config.webResearchEnabled,
      researchTaskQueue: researchTaskQueue.snapshot(),
      zeroKeyResearchTools: researchTools.zeroKeyNames(),
      keyedResearchTools: researchTools.keyedStatus()
    });
  }
  if (googleAuth.required && !authenticatedSession) {
    if (req.method === "GET" && ["/", "/index.html"].includes(url.pathname)) return googleAuth.begin(req, res, url);
    if (url.pathname.startsWith("/api/")) return json(res, 401, { ok: false, error: "需要使用 Google 账号登录", code: "google_auth_required" });
  }
  const cost = expensiveRequestCost(req.method, url.pathname);
  if (cost) {
    expensiveRateLimiter.consume(`${clientKey}:${ownerId}`);
    req.usageReceipt = await usageBudget.consume(ownerId, cost);
  }
  if (req.method === "GET" && url.pathname === "/api/reviews") {
    return json(res, 200, { ok: true, reviews: await manager.list({ ownerId }) });
  }
  if (req.method === "POST" && url.pathname === "/api/reviews") {
    const body = await readJson(req, config.maxUploadBytes * 1.42 + 1024 * 1024);
    const taskType = normalizeTaskType(body.taskType);
    if (taskType === "attachment_review") validateUploadBody(body);
    if (taskType === "company_pre_research") validateCompanyResearchBody(body);
    if (taskType === "industry_research") validateIndustryResearchBody(body);
    if (taskType === "paper_analysis") validatePaperAnalysisBody(body);
    const review = await manager.create({
      taskType,
      companyName: body.companyName,
      instruction: body.instruction,
      outputLanguage: normalizeOutputLanguage(body.outputLanguage),
      researchTemplate: body.researchTemplate,
      sourceUrl: body.sourceUrl,
      ...(body.file ? { upload: normalizeUpload(body.file) } : {})
    }, { ownerId });
    return json(res, 202, { ok: true, review });
  }

  const match = url.pathname.match(/^\/api\/reviews\/([a-zA-Z0-9_-]+)(?:\/(events|pdf|conversation-pdf|messages|retry|reanalyze|refresh|company-match))?$/);
  if (match) {
    const [, id, action] = match;
    if (req.method === "GET" && action === "events") return streamReviewEvents(req, res, id, ownerId);
    if (req.method === "GET" && action === "pdf") return downloadPdf(res, id, ownerId);
    if (req.method === "GET" && action === "conversation-pdf") return downloadConversationPdf(res, id, ownerId);
    if (req.method === "POST" && action === "messages") return streamAnswer(req, res, id, ownerId);
    if (req.method === "POST" && action === "company-match") return matchAndRouteBp(req, res, id, ownerId);
    if (req.method === "POST" && action === "retry") return json(res, 202, { ok: true, review: await manager.retry(id, { ownerId }) });
    if (req.method === "POST" && action === "reanalyze") {
      const body = await readJson(req, 16 * 1024);
      return json(res, 202, { ok: true, review: await manager.reanalyze(id, { ownerId, outputLanguage: body.outputLanguage ? normalizeOutputLanguage(body.outputLanguage) : undefined }) });
    }
    if (req.method === "POST" && action === "refresh") return json(res, 202, { ok: true, review: await manager.refreshEvidence(id, { ownerId }) });
    if (req.method === "DELETE" && !action) return json(res, 200, { ok: true, result: await manager.deleteConversation(id, { ownerId }) });
    if (req.method === "GET" && !action) return json(res, 200, { ok: true, review: await manager.get(id, { ownerId }) });
  }
  if (req.method === "GET") return publicAssets.serve(res, url.pathname);
  json(res, 404, { ok: false, error: "Not found" });
}

async function matchAndRouteBp(req, res, id, ownerId) {
  const body = await readJson(req, config.maxUploadBytes * 1.42 + 1024 * 1024);
  validateUploadBody(body);
  const current = await manager.get(id, { ownerId });
  const decision = await companyIdentity.judgeSameCompany({
    currentCompanyName: current.companyName,
    currentReport: current.report,
    providedCompanyName: body.companyName,
    upload: body.file
  });
  if (body.apply === false) return json(res, 200, { ok: true, decision });
  const input = { companyName: decision.newCompanyName || String(body.companyName || "").trim(), instruction: body.instruction || "全面核查这份 BP", outputLanguage: normalizeOutputLanguage(body.outputLanguage), upload: normalizeUpload(body.file) };
  const sameCompany = decision.sameCompany;
  const review = sameCompany
    ? await manager.replaceBp(id, input, { ownerId })
    : await manager.create(input, { ownerId });
  return json(res, 202, { ok: true, decision, action: sameCompany ? "reanalyze_current" : "created_new", review });
}

async function streamReviewEvents(req, res, id, ownerId) {
  const snapshot = await manager.get(id, { ownerId });
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  writeSse(res, { type: "snapshot", data: snapshot, at: new Date().toISOString() });
  const unsubscribe = manager.subscribe(id, (event) => writeSse(res, event));
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

async function streamAnswer(req, res, id, ownerId) {
  const body = await readJson(req, 64 * 1024);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) void logger.info("followup.client_disconnected", { requestId: req.requestId, jobId: id });
  });
  try {
    const answer = await manager.ask(id, body.message, {
      ownerId,
      signal: controller.signal,
      onStatus: (message) => writeSse(res, { type: "status", data: { message } }),
      onProgress: (progress) => writeSse(res, { type: "progress", data: progress }),
      onDelta: (delta) => writeSse(res, { type: "delta", data: { delta } })
    });
    writeSse(res, { type: "done", data: { answer } });
  } catch (error) {
    await logger.error("followup.stream_failed", { requestId: req.requestId, jobId: id, error });
    const failure = publicError(error, { requestId: req.requestId });
    writeSse(res, { type: "error", data: { message: failure.body.error, requestId: req.requestId } });
  }
  res.end();
}

async function downloadPdf(res, id, ownerId) {
  const review = await manager.get(id, { ownerId });
  if (!review.report) throw Object.assign(new Error("报告尚未生成"), { statusCode: 409 });
  const buffer = await lazyPdf.getOrRender(review);
  const filename = encodeURIComponent(`${safeFilename(review.companyName || "研究")}-${reportTitle(review).replace(`${review.companyName || "未命名主题"} `, "")}.pdf`);
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Length": buffer.length,
    "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    "Cache-Control": "private, no-store"
  });
  res.end(buffer);
}

async function downloadConversationPdf(res, id, ownerId) {
  const review = await manager.get(id, { ownerId });
  const conversation = buildConversationExport(review);
  const buffer = await pdf.renderConversation(conversation);
  const filename = encodeURIComponent(`${safeFilename(review.companyName || "VentureLens")}-完整对话.pdf`);
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Length": buffer.length,
    "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    "Cache-Control": "private, no-store"
  });
  res.end(buffer);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location || "/", "Cache-Control": "no-store" });
  res.end();
}

async function readJson(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("请求内容过大"), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("请求 JSON 无效"), { statusCode: 400 });
  }
}

function validateUploadBody(body) {
  if (!body.file?.data || !body.file?.filename) throw Object.assign(new Error("请上传 BP 文件"), { statusCode: 400 });
}

function validateCompanyResearchBody(body) {
  if (!String(body.companyName || "").trim()) throw Object.assign(new Error("公司预研需要填写公司名称"), { statusCode: 400 });
}

function validateIndustryResearchBody(body) {
  if (!String(body.companyName || "").trim()) throw Object.assign(new Error("行业研究需要填写行业或技术主题"), { statusCode: 400 });
}

function validatePaperAnalysisBody(body) {
  if (!body.file?.data && !/^https?:\/\//i.test(String(body.sourceUrl || ""))) {
    throw Object.assign(new Error("论文解读需要上传 PDF 或填写论文 URL"), { statusCode: 400 });
  }
  if (body.file && !/\.pdf$/i.test(String(body.file.filename || "")) && !/application\/pdf/i.test(String(body.file.mimeType || ""))) {
    throw Object.assign(new Error("论文解读仅支持 PDF 文件"), { statusCode: 400 });
  }
}

function normalizeTaskType(value) {
  return ["company_pre_research", "industry_research", "paper_analysis"].includes(value) ? value : "attachment_review";
}

function normalizeOutputLanguage(value) {
  return String(value || "").toLowerCase().startsWith("en") ? "en" : "zh";
}

function normalizeUpload(file) {
  return {
    filename: sanitizeVisibleFilename(file.filename),
    mimeType: String(file.mimeType || "application/octet-stream"),
    size: Number(file.size || 0),
    data: String(file.data || "")
  };
}

function writeSse(res, event) {
  if (!res.writableEnded && !res.destroyed) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data || {})}\n\n`);
}

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length });
  res.end(body);
}

function safeFilename(value) {
  return String(value || "BP").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
}

server.listen(config.port, config.host, async () => {
  await logger.info("server.started", { host: config.host, port: config.port, model: config.model.model, modelConfigured: Boolean(config.model.apiKey) });
  const jobs = await repository.list({ limit: 100 });
  const recovery = await recoverActiveReviews({ jobs, manager, staleAfterMs: config.recovery.staleAfterMs });
  await logger.info("server.recovery_completed", { resumed: recovery.resumed.length, failed: recovery.failed.length, refreshes: recovery.refreshes.length });
  void retention.cleanup().catch((error) => logger.error("retention.cleanup_failed", { error }));
});

function expensiveRequestCost(method, pathname) {
  if (method !== "POST") return 0;
  if (pathname === "/api/reviews") return 10;
  if (/\/messages$/.test(pathname)) return 3;
  if (/\/(?:retry|reanalyze|company-match)$/.test(pathname)) return 10;
  if (/\/refresh$/.test(pathname)) return 5;
  return 0;
}

async function shutdown(signal) {
  clearInterval(retentionTimer);
  await logger.info("server.stopping", { signal });
  server.close(async () => {
    await processLease.release();
    process.exit(0);
  });
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
server.on("close", () => void processLease.release());

function reportTitle(review) {
  if (review.outputLanguage === "en") {
    const suffix = ({ company_pre_research: "Company Research Report", industry_research: "Industry Research Report", paper_analysis: "Paper Analysis" })[review.taskType] || "BP Review Report";
    return `${review.companyName || "Untitled Subject"} ${suffix}`;
  }
  const suffix = ({ company_pre_research: "公司预研报告", industry_research: "行业研究报告", paper_analysis: "论文解读" })[review.taskType] || "BP 核查报告";
  return `${review.companyName || "未命名主题"} ${suffix}`;
}
