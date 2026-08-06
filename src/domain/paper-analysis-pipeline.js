import { randomUUID } from "node:crypto";
import { redactSensitiveText } from "../../public/privacy-redaction.js";
import { Result } from "./result.js";
import { normalizeEvidenceSources } from "./research-evidence-service.js";
import { completeStructuredJson } from "./structured-model-call.js";
import { buildPaperFallback, buildPaperMetadataMessages, buildPaperReportMessages } from "./paper-analysis-prompts.js";
import { assessPaperAnalysisQuality, stabilizePaperAnalysisReport } from "./paper-analysis-quality.js";

export function createPaperAnalysisPipeline({ extractor, model, repository, paperSourceFetcher, pdfReportService, webResearchEnabled = true, now = () => new Date().toISOString() }) {
  const steps = [
    { key: "source-acquisition", label: "获取论文原文", run: acquireSource },
    { key: "paper-parsing", label: "解析论文正文与页码", run: parsePaper },
    { key: "metadata-extraction", label: "识别论文元数据", run: extractMetadata },
    { key: "academic-research", label: "检索论文影响与相关工作", run: collectAcademicSources },
    { key: "report-generation", label: "生成论文解读报告", run: generateReport },
    { key: "quality-gate", label: "检查技术栏目与证据", run: qualityGate },
    { key: "persist-report", label: "保存报告与版本", run: persistReport }
  ];

  async function execute(job, { onEvent = () => {}, signal } = {}) {
    let context = { job, onEvent, signal };
    for (const [index, step] of steps.entries()) {
      if (signal?.aborted) return Result.fail("任务已终止", { failedStep: step.key });
      if (context.job.checkpoints?.[step.key]?.completed) {
        context = { ...context, ...(context.job.checkpoints[step.key].artifact || {}) };
        emit(context, "stage", stageEvent(step, index, steps.length, "restored", "已从 checkpoint 恢复"));
        continue;
      }
      emit(context, "stage", stageEvent(step, index, steps.length, "running", runningMessage(step.key)));
      try {
        context.job = await repository.save(context.job);
        context = await step.run(context);
        emit(context, "stage", stageEvent(step, index, steps.length, "completed", completedMessage(step.key, context)));
        context.job = await repository.save({ ...context.job, checkpoints: { ...(context.job.checkpoints || {}), [step.key]: { completed: true, at: now(), artifact: checkpointArtifact(context, step.key) } } });
      } catch (error) {
        emit(context, "stage", stageEvent(step, index, steps.length, "failed", error.message || String(error)));
        await repository.save(context.job).catch(() => {});
        return Result.fail(error, { failedStep: step.key, context });
      }
    }
    emit(context, "report_complete", { report: context.report, quality: context.quality, status: context.job.status, sources: context.sources, followupSuggestions: context.job.followupSuggestions });
    return Result.ok(context);
  }

  async function acquireSource(context) {
    if (context.job.upload?.persisted) return { ...context, acquired: { kind: "upload", filename: context.job.upload.filename, storagePath: context.job.upload.storagePath } };
    if (!context.job.sourceUrl || typeof paperSourceFetcher?.fetchPage !== "function") throw new Error("论文 URL 获取服务不可用，请上传 PDF");
    let page = await paperSourceFetcher.fetchPage(context.job.sourceUrl, { signal: context.signal });
    if (page.ok && !String(page.contentType || "").includes("pdf")) {
      const pdfLink = (page.links || []).find((link) => /\.pdf(?:$|[?#])|\bpdf\b/i.test(`${link.url} ${link.anchor}`));
      if (pdfLink) page = await paperSourceFetcher.fetchPage(pdfLink.url, { signal: context.signal });
    }
    if (!page.ok) throw new Error(`论文 URL 获取失败：${page.error || `HTTP ${page.status}`}`);
    if (String(page.text || "").replace(/\s/g, "").length < 200) throw new Error("论文 URL 未返回足够正文，请改为上传 PDF");
    return { ...context, acquired: { kind: "url", filename: page.title || "paper.pdf", resolvedUrl: page.url, document: { text: page.text, pages: splitExtractedPages(page.text), pageCount: null, engine: "public-url" } } };
  }

  async function parsePaper(context) {
    if (context.acquired.document) return { ...context, document: context.acquired.document };
    const buffer = await repository.getUpload(context.job.id, context.acquired.storagePath);
    if (!buffer?.length) throw new Error("论文原始 PDF 未保存，请重新上传");
    const result = await extractor.extract({ buffer, filename: context.acquired.filename, mimeType: "application/pdf" }, { signal: context.signal, onProgress: (progress) => emit(context, "stage", stageFor("paper-parsing", "running", progress.message || "正在解析论文…")) });
    if (!result.ok) throw new Error(result.error);
    return { ...context, document: result.value };
  }

  async function extractMetadata(context) {
    let metadataWarning = "";
    let metadata;
    try {
      metadata = await completeStructuredJson({
        model,
        messages: buildPaperMetadataMessages({ title: context.job.companyName, sourceUrl: context.job.sourceUrl, document: context.document }),
        signal: context.signal,
        maxTokens: 3000,
        validate: normalizeMetadata,
        onRetry: () => emit(context, "stage", stageFor("metadata-extraction", "running", "论文元数据格式异常，正在自动修复…"))
      });
    } catch (error) {
      if (context.signal?.aborted) throw error;
      metadataWarning = `论文元数据抽取降级：${error.message || error}`;
      metadata = normalizeMetadata({ title: context.job.companyName || context.job.upload?.filename?.replace(/\.pdf$/i, "") || context.acquired.filename });
    }
    if (metadata.title && metadata.title !== context.job.companyName) {
      context.job = await repository.save({ ...context.job, companyName: metadata.title, title: `${metadata.title} · 论文解读` });
      emit(context, "stage", stageFor("metadata-extraction", "running", `已识别论文：${metadata.title}`));
    }
    return { ...context, metadata, metadataWarning };
  }

  async function collectAcademicSources(context) {
    if (!webResearchEnabled || typeof model.webSearch !== "function") return { ...context, sources: [], researchWarning: "联网学术检索未启用" };
    const title = context.metadata.title || context.job.companyName;
    const queries = unique([title, context.metadata.doi, context.metadata.arxivId, `${title} citations related work`, `${title} code benchmark`]).slice(0, 6);
    try {
      const values = await model.webSearch({ companyName: title, queries, requestedTools: ["general_web_search", "arxiv_paper_search", "scholarly_works_search", "openalex_research_search"], signal: context.signal, onToolCall: (tool) => emit(context, "stage", stageFor("academic-research", "running", `正在调用 ${tool.label} 工具…`)) });
      const sources = normalizeEvidenceSources(values).map((source) => ({ ...source, retrievedAt: source.retrievedAt || now() }));
      return { ...context, sources, researchWarning: sources.length ? "" : "学术检索完成，但未形成外部来源" };
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return { ...context, sources: [], researchWarning: `学术资料检索降级：${error.message || error}` };
    }
  }

  async function generateReport(context) {
    const messages = buildPaperReportMessages({ metadata: context.metadata, document: context.document, sources: context.sources, instruction: context.job.instruction, sourceUrl: context.job.sourceUrl || context.acquired.resolvedUrl, researchWarning: context.researchWarning });
    let lastError = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let streamed = "";
      let visible = false;
      try {
        const report = await model.stream(messages, { signal: context.signal, maxTokens: 11000, onDelta: (value) => {
          const delta = redactSensitiveText(value);
          streamed += delta;
          if (!visible && streamed.length >= 300) { visible = true; emit(context, "report_delta", { delta: streamed }); }
          else if (visible) emit(context, "report_delta", { delta });
        } });
        const best = redactSensitiveText(report || streamed);
        if (best.length >= 300) return { ...context, report: best };
        lastError = `第 ${attempt} 次输出仅 ${best.length} 个字符`;
      } catch (error) {
        if (context.signal?.aborted) throw error;
        lastError = error.message || String(error);
      }
      emit(context, "stage", stageFor("report-generation", "running", `解读输出异常，正在自动重试（${attempt}/2）…`));
    }
    const generationWarning = `论文解读输出异常：${lastError}`;
    const report = buildPaperFallback({ metadata: context.metadata, document: context.document, sources: context.sources, sourceUrl: context.job.sourceUrl, warning: generationWarning });
    emit(context, "report_delta", { delta: report });
    return { ...context, report, generationWarning };
  }

  async function qualityGate(context) {
    const sourceUrl = context.job.sourceUrl || context.acquired.resolvedUrl || "";
    const report = stabilizePaperAnalysisReport(context.report, { title: context.metadata.title, sources: context.sources, sourceUrl });
    const warnings = [context.metadataWarning, context.researchWarning, context.generationWarning];
    return { ...context, report, quality: assessPaperAnalysisQuality(report, { document: context.document, metadata: context.metadata, sources: context.sources, sourceUrl, warnings }) };
  }

  async function persistReport(context) {
    await repository.saveReport(context.job.id, context.report);
    let pdfStoragePath = context.job.pdfStoragePath || "";
    if (pdfReportService && repository.savePdf) {
      const pdf = await pdfReportService.render({ title: `${context.metadata.title || context.job.companyName} 论文解读`, markdown: context.report });
      pdfStoragePath = await repository.savePdf(context.job.id, pdf, { date: context.job.createdAt || now() });
    }
    const finalJob = { ...context.job, status: context.quality.ok ? "completed" : "needs_attention", reportAvailable: true, pdfStoragePath, quality: context.quality, sources: context.sources, analysis: { paperMetadata: context.metadata }, researchPlan: { tools: ["arxiv_paper_search", "scholarly_works_search", "openalex_research_search"] }, researchWarning: context.researchWarning || "", generationWarning: context.generationWarning || "", extractionWarning: context.metadataWarning || "", followupSuggestions: ["这篇论文最核心的技术创新是什么？", "实验设计有哪些不足或未覆盖场景？", "距离产业化还缺少哪些验证？", "有哪些相关论文、代码或团队值得继续跟踪？"], reanalysisInProgress: false, error: "", failedStep: "", completedAt: now() };
    await repository.save(finalJob);
    return { ...context, job: finalJob };
  }

  function stageFor(key, status, message) { const index = steps.findIndex((step) => step.key === key); return stageEvent(steps[index], index, steps.length, status, message); }
  return { execute, steps: steps.map(({ key, label }) => ({ key, label })) };
}

export function createPaperAnalysisJob({ title, instruction, sourceUrl, upload = null, steps, now = () => new Date().toISOString() }) {
  const createdAt = now();
  const name = String(title || upload?.filename?.replace(/\.pdf$/i, "") || "待识别论文").trim();
  return { id: `paper_${randomUUID().replace(/-/g, "").slice(0, 20)}`, taskType: "paper_analysis", companyName: name, title: `${name} · 论文解读`, instruction: String(instruction || "从技术、可信度、行业价值和商业化角度解读论文").trim(), sourceUrl: String(sourceUrl || "").trim(), upload, status: "queued", stages: steps.map((step) => ({ ...step, status: "pending" })), checkpoints: {}, messages: [], createdAt, updatedAt: createdAt };
}

function normalizeMetadata(value) {
  return { title: singleLine(value?.title), authors: array(value?.authors).map(singleLine).filter(Boolean).slice(0, 40), institutions: array(value?.institutions).map(singleLine).filter(Boolean).slice(0, 30), publicationYear: singleLine(value?.publicationYear), doi: singleLine(value?.doi), arxivId: singleLine(value?.arxivId), venue: singleLine(value?.venue), abstract: String(value?.abstract || "").trim().slice(0, 3000), researchField: singleLine(value?.researchField), keywords: array(value?.keywords).map(singleLine).filter(Boolean).slice(0, 20) };
}

function splitExtractedPages(text) {
  const matches = Array.from(String(text || "").matchAll(/^--- 第 (\d+) 页 ---$/gm));
  if (!matches.length) return [{ page: 1, text: String(text || "") }];
  return matches.map((match, index) => ({ page: Number(match[1]), text: String(text).slice(match.index + match[0].length, matches[index + 1]?.index ?? String(text).length).trim() }));
}

function checkpointArtifact(context, key) {
  return ({ "source-acquisition": { acquired: context.acquired }, "paper-parsing": { document: context.document }, "metadata-extraction": { metadata: context.metadata, metadataWarning: context.metadataWarning }, "academic-research": { sources: context.sources, researchWarning: context.researchWarning }, "report-generation": { report: context.report, generationWarning: context.generationWarning }, "quality-gate": { report: context.report, quality: context.quality }, "persist-report": {} })[key] || {};
}

function emit(context, type, data) {
  if (type === "stage" && Array.isArray(context.job?.stages)) context.job = { ...context.job, stages: context.job.stages.map((stage) => stage.key === data.key ? { ...stage, status: data.status, message: data.message, updatedAt: new Date().toISOString() } : stage) };
  context.onEvent?.({ type, data, at: new Date().toISOString() });
}

function stageEvent(step, index, total, status, message) { return { key: step.key, label: step.label, index, total, status, message }; }
function runningMessage(key) { return ({ "source-acquisition": "正在读取上传 PDF 或安全抓取论文 URL…", "paper-parsing": "正在解析正文、页码和 OCR 结果…", "metadata-extraction": "正在识别标题、作者、机构、DOI 和摘要…", "academic-research": "正在调用 arXiv、Crossref、OpenAlex 与网页搜索…", "report-generation": "正在区分论文事实、外部资料和系统推断…", "quality-gate": "正在检查技术栏目、页码证据和引用边界…", "persist-report": "正在保存论文解读和 checkpoint…" })[key]; }
function completedMessage(key, context) {
  if (key === "source-acquisition") return context.acquired.kind === "upload" ? "已读取上传论文" : "已安全抓取论文 URL";
  if (key === "paper-parsing") return `已解析 ${context.document.pageCount || context.document.pages?.length || 1} 页、${context.document.text.length} 个字符`;
  if (key === "metadata-extraction") return context.metadataWarning || `已识别论文：${context.metadata.title || "标题待核验"}`;
  if (key === "academic-research") return context.sources.length ? `已整理 ${context.sources.length} 个学术与外部来源` : context.researchWarning;
  if (key === "report-generation") return `论文解读已生成，共 ${context.report.length} 个字符`;
  if (key === "quality-gate") return `质量评分 ${context.quality.score}`;
  return "论文解读已保存，可下载 PDF";
}
function singleLine(value) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, 500); }
function unique(values) { return Array.from(new Set(values.filter(Boolean))); }
function array(value) { return Array.isArray(value) ? value : []; }
