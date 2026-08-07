import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile, getRuntimeConfig } from "./src/config/runtime-config.js";
import { createBpReviewPipeline } from "./src/domain/bp-review-pipeline.js";
import { createCompanyPreResearchPipeline } from "./src/domain/company-pre-research-pipeline.js";
import { createCompanyIdentityService } from "./src/domain/company-identity-service.js";
import { buildConversationExport } from "./src/domain/conversation-export-service.js";
import { createEvidenceRefreshService } from "./src/domain/evidence-refresh-service.js";
import { createIndustryResearchPipeline } from "./src/domain/industry-research-pipeline.js";
import { createInvestmentAnalysisService } from "./src/domain/investment-analysis-service.js";
import { createPaperAnalysisPipeline } from "./src/domain/paper-analysis-pipeline.js";
import { createReviewManagerService } from "./src/domain/review-manager-service.js";
import { recoverActiveReviews } from "./src/domain/startup-recovery-service.js";
import { normalizeReviewReport } from "./src/domain/report-summary-service.js";
import { createDeepSeekModelService } from "./src/infra/deepseek-model-service.js";
import { createBrowserSessionService } from "./src/infra/browser-session-service.js";
import { createBoundedTaskQueue } from "./src/infra/bounded-task-queue.js";
import { createDocumentExtractionService } from "./src/infra/document-extraction-service.js";
import { createEvidenceVerificationService } from "./src/infra/evidence-verification-service.js";
import { createLinkedPageResearchService } from "./src/infra/linked-page-research-service.js";
import { createPdfReportService } from "./src/infra/pdf-report-service.js";
import { createPdfWorkerExtractionService } from "./src/infra/pdf-worker-extraction-service.js";
import { createStructuredResearchToolService } from "./src/infra/research-tools/structured-research-tool-service.js";
import { sanitizeVisibleFilename } from "./public/privacy-redaction.js";
import { createFileReviewRepository } from "./src/storage/file-review-repository.js";

loadEnvFile();
const config = getRuntimeConfig();
const repository = createFileReviewRepository({ dataDir: config.dataDir });
await repository.initialize();
const researchTools = createStructuredResearchToolService({ credentials: config.researchTools });
const pdfExtractionQueue = createBoundedTaskQueue({ concurrency: config.documents.pdfConcurrency });
const pdfExtractor = createPdfWorkerExtractionService({ timeoutMs: config.documents.pdfTimeoutMs, queue: pdfExtractionQueue });
const extractor = createDocumentExtractionService({ maxBytes: config.maxUploadBytes, pdfExtractor });
const linkedPageResearch = createLinkedPageResearchService({ documentExtractor: extractor });
const model = createDeepSeekModelService({ config: config.model, researchTools, linkedPageResearch });
const companyIdentity = createCompanyIdentityService({ extractor, model });
const investmentAnalysis = createInvestmentAnalysisService({ model });
const evidenceVerification = createEvidenceVerificationService();
const evidenceRefresh = createEvidenceRefreshService({ model, repository });
const pdf = createPdfReportService();
const pipeline = createBpReviewPipeline({ extractor, model, repository, pdfReportService: pdf, investmentAnalysisService: investmentAnalysis, evidenceVerificationService: evidenceVerification, webResearchEnabled: config.webResearchEnabled });
const companyResearchPipeline = createCompanyPreResearchPipeline({ model, repository, pdfReportService: pdf, webResearchEnabled: config.webResearchEnabled });
const industryResearchPipeline = createIndustryResearchPipeline({ model, repository, pdfReportService: pdf, webResearchEnabled: config.webResearchEnabled });
const paperSourceFetcher = createLinkedPageResearchService({ documentExtractor: extractor, limits: { maxPdfBytes: config.maxUploadBytes, timeoutMs: 20000 } });
const paperAnalysisPipeline = createPaperAnalysisPipeline({ extractor, model, repository, paperSourceFetcher, pdfReportService: pdf, webResearchEnabled: config.webResearchEnabled });
const manager = createReviewManagerService({ pipeline, companyResearchPipeline, industryResearchPipeline, paperAnalysisPipeline, repository, model, evidenceRefreshService: evidenceRefresh });
const browserSessions = createBrowserSessionService();
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    if (res.headersSent) return res.end();
    json(res, error.statusCode || 500, { ok: false, error: error.message || "服务器错误" });
  }
});

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const browserSession = browserSessions.resolve(req, res);
  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, {
      ok: true,
      model: config.model.model,
      modelConfigured: Boolean(config.model.apiKey),
      webResearchEnabled: config.webResearchEnabled,
      zeroKeyResearchTools: researchTools.zeroKeyNames(),
      keyedResearchTools: researchTools.keyedStatus()
    });
  }
  if (req.method === "GET" && url.pathname === "/api/reviews") {
    return json(res, 200, { ok: true, reviews: await manager.list({ ownerId: browserSession.id }) });
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
    }, { ownerId: browserSession.id });
    return json(res, 202, { ok: true, review });
  }

  const match = url.pathname.match(/^\/api\/reviews\/([a-zA-Z0-9_-]+)(?:\/(events|pdf|conversation-pdf|messages|retry|reanalyze|refresh|company-match))?$/);
  if (match) {
    const [, id, action] = match;
    if (req.method === "GET" && action === "events") return streamReviewEvents(req, res, id, browserSession.id);
    if (req.method === "GET" && action === "pdf") return downloadPdf(res, id, browserSession.id);
    if (req.method === "GET" && action === "conversation-pdf") return downloadConversationPdf(res, id, browserSession.id);
    if (req.method === "POST" && action === "messages") return streamAnswer(req, res, id, browserSession.id);
    if (req.method === "POST" && action === "company-match") return matchAndRouteBp(req, res, id, browserSession.id);
    if (req.method === "POST" && action === "retry") return json(res, 202, { ok: true, review: await manager.retry(id, { ownerId: browserSession.id }) });
    if (req.method === "POST" && action === "reanalyze") {
      const body = await readJson(req, 16 * 1024);
      return json(res, 202, { ok: true, review: await manager.reanalyze(id, { ownerId: browserSession.id, outputLanguage: body.outputLanguage ? normalizeOutputLanguage(body.outputLanguage) : undefined }) });
    }
    if (req.method === "POST" && action === "refresh") return json(res, 202, { ok: true, review: await manager.refreshEvidence(id, { ownerId: browserSession.id }) });
    if (req.method === "DELETE" && !action) return json(res, 200, { ok: true, result: await manager.deleteConversation(id, { ownerId: browserSession.id }) });
    if (req.method === "GET" && !action) return json(res, 200, { ok: true, review: await manager.get(id, { ownerId: browserSession.id }) });
  }
  if (req.method === "GET") return serveStatic(res, url.pathname);
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
  req.on("close", () => controller.abort());
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
    writeSse(res, { type: "error", data: { message: error.message || String(error) } });
  }
  res.end();
}

async function downloadPdf(res, id, ownerId) {
  const review = await manager.get(id, { ownerId });
  if (!review.report) throw Object.assign(new Error("报告尚未生成"), { statusCode: 409 });
  const buffer = await pdf.render({ title: reportTitle(review), markdown: review.report });
  const pdfStoragePath = await repository.savePdf(id, buffer, { date: review.createdAt || review.completedAt });
  const job = await repository.get(id);
  if (job) await repository.save({ ...job, pdfStoragePath });
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

async function serveStatic(res, pathname) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const target = path.resolve(publicDir, relative);
  if (!target.startsWith(`${publicDir}${path.sep}`) && target !== path.join(publicDir, "index.html")) {
    return json(res, 403, { ok: false, error: "Forbidden" });
  }
  try {
    if (!(await stat(target)).isFile()) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
    const content = await readFile(target);
    res.writeHead(200, {
      "Content-Type": mimeType(target),
      "Cache-Control": /\.(?:html|js|css)$/.test(target) ? "no-cache" : "public, max-age=3600"
    });
    res.end(content);
  } catch (error) {
    if (error.code === "ENOENT") return json(res, 404, { ok: false, error: "Not found" });
    throw error;
  }
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
  if (!res.writableEnded) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data || {})}\n\n`);
}

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length });
  res.end(body);
}

function mimeType(file) {
  return ({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" })[path.extname(file)] || "application/octet-stream";
}

function safeFilename(value) {
  return String(value || "BP").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
}

server.listen(config.port, config.host, async () => {
  process.stdout.write(`VentureLens running at http://${config.host}:${config.port}\n`);
  process.stdout.write(`DeepSeek ${config.model.apiKey ? "configured" : "not configured"} · model ${config.model.model}\n`);
  const jobs = await repository.list({ limit: 100 });
  for (const job of jobs) {
    if (job.reportAvailable) await ensureStoredPdf(job).catch((error) => process.stderr.write(`PDF backfill ${job.id}: ${error.message}\n`));
  }
  const recovery = await recoverActiveReviews({ jobs, manager, staleAfterMs: config.recovery.staleAfterMs });
  process.stdout.write(`Recovery resumed ${recovery.resumed.length}, stopped stale ${recovery.failed.length}\n`);
});

async function ensureStoredPdf(job) {
  if (await repository.getPdf(job.id, job.pdfStoragePath)) return;
  const storedReport = await repository.getReport(job.id);
  if (!storedReport) return;
  const markdown = normalizeReviewReport(job, storedReport);
  const buffer = await pdf.render({ title: reportTitle(job), markdown });
  const pdfStoragePath = await repository.savePdf(job.id, buffer, { date: job.createdAt || job.completedAt });
  await repository.save({ ...job, pdfStoragePath });
}

function reportTitle(review) {
  if (review.outputLanguage === "en") {
    const suffix = ({ company_pre_research: "Company Research Report", industry_research: "Industry Research Report", paper_analysis: "Paper Analysis" })[review.taskType] || "BP Review Report";
    return `${review.companyName || "Untitled Subject"} ${suffix}`;
  }
  const suffix = ({ company_pre_research: "公司预研报告", industry_research: "行业研究报告", paper_analysis: "论文解读" })[review.taskType] || "BP 核查报告";
  return `${review.companyName || "未命名主题"} ${suffix}`;
}
