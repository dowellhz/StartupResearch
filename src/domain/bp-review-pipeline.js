import { randomUUID } from "node:crypto";
import { buildBpBusinessAudit } from "./bp-business-audit.js";
import { buildClaimLedger } from "./claim-ledger.js";
import { Result } from "./result.js";
import { assessReportQuality, stabilizeReport } from "./report-quality-service.js";
import { buildFallbackReport } from "./report-fallback.js";
import { buildEvidenceAssessment, normalizeEvidenceSources } from "./research-evidence-service.js";
import { buildFollowupSuggestions } from "./followup-suggestion-service.js";
import { summarizeInvestmentAnalysis } from "./investment-analysis-service.js";
import { buildReviewResearchPlan } from "./research-tool-planner.js";
import { buildExtractionMessages, buildReportMessages } from "./review-prompts.js";
import { completeStructuredJson } from "./structured-model-call.js";
import { redactSensitiveText, sanitizeVisibleFilename } from "../../public/privacy-redaction.js";
import {
  assessDetectedCompanyIdentity,
  checkpointArtifact,
  completedMessage,
  emit,
  fallbackAnalysis,
  joinWarnings,
  BP_PIPELINE_VERSION,
  prepareJobForPipeline,
  restoreCheckpoint,
  runningMessage,
  stageEvent,
  validateAnalysis
} from "./bp-review-pipeline-support.js";

export function createBpReviewPipeline({ extractor, model, repository, pdfReportService, investmentAnalysisService, evidenceVerificationService, webResearchEnabled = true, now = () => new Date().toISOString() }) {
  if (!evidenceVerificationService) throw new Error("evidence verification dependency is required");
  const steps = [
    { key: "document-parse", label: "解析商业计划书", run: parseDocument },
    { key: "claim-extraction", label: "提取关键声明与假设", run: extractClaims },
    { key: "business-audit", label: "审计数字与经营假设", run: auditBusinessClaims },
    { key: "review-framework", label: "建立核查框架", run: buildFramework },
    { key: "public-research", label: "检索公开资料", run: collectPublicSources },
    { key: "cross-check", label: "交叉核查与风险研判", run: crossCheck },
    { key: "evidence-verification", label: "核验页码与原文证据", run: verifyEvidence },
    { key: "investment-analysis", label: "形成投资分析与版本比较", run: analyzeInvestment },
    { key: "report-generation", label: "撰写研究报告", run: generateReport },
    { key: "quality-gate", label: "报告质量检查", run: qualityGate },
    { key: "persist-report", label: "保存报告与版本", run: persistReport }
  ];

  async function execute(job, { onEvent = () => {}, signal } = {}) {
    let context = { job: prepareJobForPipeline(job, steps), signal, onEvent };
    for (const [index, step] of steps.entries()) {
      if (signal?.aborted) return Result.fail("任务已终止", { failedStep: step.key });
      if (context.job.checkpoints?.[step.key]?.completed) {
        context = restoreCheckpoint(context, step.key);
        emit(context, "stage", stageEvent(step, index, steps.length, "restored", "已从 checkpoint 恢复"));
        continue;
      }
      emit(context, "stage", stageEvent(step, index, steps.length, "running", runningMessage(step.key)));
      try {
        context.job = await repository.save(context.job);
        context = await step.run(context);
        const completion = stageEvent(step, index, steps.length, "completed", completedMessage(step.key, context));
        if (step.key === "claim-extraction") Object.assign(completion, { companyName: context.job.companyName, title: context.job.title });
        emit(context, "stage", completion);
        await checkpoint(context, step.key);
      } catch (error) {
        emit(context, "stage", stageEvent(step, index, steps.length, "failed", error.message || String(error)));
        await repository.save(context.job).catch(() => {});
        return Result.fail(error, { failedStep: step.key, context });
      }
    }
    emit(context, "report_complete", {
      report: context.report,
      quality: context.quality,
      status: context.job.status,
      sources: context.sources,
      evidenceTrustSummary: context.evidenceManifest?.summary,
      claimLedgerSummary: context.claimLedger?.summary,
      businessAuditSummary: context.businessAudit?.summary,
      investmentAnalysisSummary: summarizeInvestmentAnalysis(context.investmentAnalysis),
      followupSuggestions: context.job.followupSuggestions
    });
    return Result.ok(context);
  }

  async function parseDocument(context) {
    const persistedUpload = typeof repository.getUpload === "function"
      ? await repository.getUpload(context.job.id, context.job.upload.storagePath)
      : null;
    const buffer = persistedUpload || Buffer.from(context.job.upload.data || "", "base64");
    const result = await extractor.extract({
      buffer,
      filename: context.job.upload.filename,
      mimeType: context.job.upload.mimeType
    }, {
      signal: context.signal,
      onProgress: ({ message }) => emit(context, "stage", stageFor("document-parse", "running", message))
    });
    if (!result.ok) throw new Error(result.error);
    return {
      ...context,
      document: { ...result.value, text: redactSensitiveText(result.value.text), filename: sanitizeVisibleFilename(context.job.upload.filename) },
      job: { ...context.job, upload: { ...context.job.upload, filename: sanitizeVisibleFilename(context.job.upload.filename), data: "" } }
    };
  }

  async function extractClaims(context) {
    let analysis;
    let extractionWarning = String(context.document.extractionWarning || "");
    try {
      analysis = await completeStructuredJson({
        model,
        messages: buildExtractionMessages({ companyName: context.job.companyName, instruction: context.job.instruction, outputLanguage: context.job.outputLanguage, document: context.document }),
        signal: context.signal,
        maxTokens: 6000,
        validate: validateAnalysis,
        onRetry: () => emit(context, "stage", stageFor("claim-extraction", "running", "DeepSeek JSON 格式异常，正在自动修复并重试（2/2）…"))
      });
    } catch (error) {
      if (context.signal?.aborted) throw error;
      extractionWarning = joinWarnings(extractionWarning, `DeepSeek 结构化提取连续两次格式异常：${error.message || error}。系统已使用保守结构继续核查。`);
      analysis = fallbackAnalysis(context, extractionWarning);
    }
    const companyIdentity = assessDetectedCompanyIdentity({
      providedCompanyName: context.job.companyName,
      instruction: context.job.instruction,
      documentText: context.document.text,
      profile: analysis.companyProfile
    });
    const companyName = companyIdentity.acceptedName;
    const job = {
      ...context.job,
      companyIdentity,
      companyName,
      title: `${companyName || "正在识别公司"} BP 核查`
    };
    return { ...context, analysis, companyIdentity, extractionWarning, job };
  }

  async function auditBusinessClaims(context) {
    return { ...context, businessAudit: buildBpBusinessAudit(context.analysis.businessAudit) };
  }

  async function buildFramework(context) {
    const framework = buildReviewResearchPlan(context.analysis, {
      companyName: context.job.companyName || context.analysis.companyProfile?.companyName
    });
    return { ...context, framework };
  }

  async function collectPublicSources(context) {
    if (!webResearchEnabled || !context.framework.searchQueries.length) {
      return { ...context, sources: [], researchWarning: "联网检索未启用或没有可执行查询" };
    }
    try {
      const sources = await model.webSearch({
        companyName: context.job.companyName || context.analysis.companyProfile?.companyName,
        queries: context.framework.searchQueries,
        claims: context.framework.criticalClaims,
        requestedTools: context.framework.requestedTools,
        onToolCall: (tool) => emit(context, "stage", stageFor("public-research", "running", `正在调用 ${tool.label} 工具…`)),
        signal: context.signal
      });
      const normalized = normalizeEvidenceSources(sources).map((source) => ({
        ...source,
        retrievedAt: source.retrievedAt || now()
      }));
      return {
        ...context,
        sources: normalized,
        researchWarning: normalized.length ? "" : "Agentic Search 已完成聚焦重试，但本次仍未形成可引用的公开来源"
      };
    } catch (error) {
      return { ...context, sources: [], researchWarning: `联网检索降级：${error.message || error}` };
    }
  }

  async function crossCheck(context) {
    const assessment = buildEvidenceAssessment({ claims: context.analysis.claims, sources: context.sources });
    const claimLedger = buildClaimLedger({
      claims: context.analysis.claims,
      sources: assessment.sources,
      coverage: assessment.coverage
    });
    return {
      ...context,
      sources: assessment.sources,
      claimLedger,
      crossCheck: { coverage: assessment.coverage, ...assessment.metrics }
    };
  }

  async function verifyEvidence(context) {
    const evidenceManifest = evidenceVerificationService.buildManifest({
      claims: context.analysis.claims,
      sources: context.sources,
      coverage: context.crossCheck.coverage,
      document: context.document,
      now: now()
    });
    return {
      ...context,
      evidenceManifest,
      claimLedger: evidenceVerificationService.enrichClaimLedger(context.claimLedger, evidenceManifest)
    };
  }

  async function analyzeInvestment(context) {
    if (!investmentAnalysisService) return { ...context, investmentAnalysis: null, investmentAnalysisWarning: "" };
    const result = await investmentAnalysisService.analyze({
      companyName: context.job.companyName,
      analysis: context.analysis,
      businessAudit: context.businessAudit,
      claimLedger: context.claimLedger,
      sources: context.sources,
      previousAnalysisSnapshot: context.job.previousAnalysisSnapshot
    }, {
      signal: context.signal,
      onRetry: () => emit(context, "stage", stageFor("investment-analysis", "running", "结构化投资分析格式异常，正在自动修复并重试（2/2）…"))
    });
    return { ...context, investmentAnalysis: result.value, investmentAnalysisWarning: result.warning };
  }

  async function generateReport(context) {
    const messages = buildReportMessages({
      companyName: context.job.companyName || context.analysis.companyProfile?.companyName,
      instruction: context.job.instruction,
      outputLanguage: context.job.outputLanguage,
      document: context.document,
      analysis: context.analysis,
      businessAudit: context.businessAudit,
      claimLedger: context.claimLedger,
      researchPlan: context.framework,
      investmentAnalysis: context.investmentAnalysis,
      sources: context.sources,
      crossCheck: context.crossCheck,
      evidenceManifest: context.evidenceManifest
    });
    let lastError = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let streamed = "";
      let visible = false;
      try {
        const report = await model.stream(messages, {
          signal: context.signal,
          maxTokens: 12000,
          thinking: false,
          onDelta: (delta) => {
            delta = redactSensitiveText(delta);
            streamed += delta;
            if (!visible && streamed.length >= 300) {
              visible = true;
              emit(context, "report_delta", { delta: streamed });
            } else if (visible) emit(context, "report_delta", { delta });
          }
        });
        const bestReport = redactSensitiveText(report || streamed);
        if (bestReport.length >= 300) return { ...context, report: bestReport };
        lastError = context.job.outputLanguage === "en" ? `attempt ${attempt} returned only ${bestReport.length} characters` : `第 ${attempt} 次输出仅 ${bestReport.length} 个字符`;
      } catch (error) {
        if (context.signal?.aborted) throw error;
        lastError = error.message || String(error);
      }
      emit(context, "stage", stageFor("report-generation", "running", `长报告输出异常，正在自动重试（${attempt}/2）…`));
    }
    const generationWarning = context.job.outputLanguage === "en"
      ? `DeepSeek full-report generation failed: ${lastError}. A recoverable report was created from the structured-stage results.`
      : `DeepSeek 长报告输出异常：${lastError}。已使用结构化阶段结果生成可恢复报告。`;
    const report = redactSensitiveText(buildFallbackReport({
      companyName: context.job.companyName,
      analysis: context.analysis,
      businessAudit: context.businessAudit,
      claimLedger: context.claimLedger,
      investmentAnalysis: context.investmentAnalysis,
      sources: context.sources,
      warning: generationWarning,
      outputLanguage: context.job.outputLanguage
    }));
    emit(context, "report_delta", { delta: report });
    return { ...context, report, generationWarning };
  }

  async function qualityGate(context) {
    const stabilized = stabilizeReport(context.report, {
      companyName: context.job.companyName,
      outputLanguage: context.job.outputLanguage,
      sources: context.sources,
      analysis: context.analysis,
      claimLedger: context.claimLedger,
      investmentAnalysis: context.investmentAnalysis
    });
    const quality = assessReportQuality(stabilized, {
      outputLanguage: context.job.outputLanguage,
      sources: context.sources,
      crossCheck: context.crossCheck,
      businessAudit: context.businessAudit,
      claimLedger: context.claimLedger,
      investmentAnalysis: context.investmentAnalysis,
      document: context.document,
      companyIdentity: context.companyIdentity || context.job.companyIdentity,
      evidenceManifest: context.evidenceManifest
    });
    if (context.generationWarning) {
      quality.ok = false;
      quality.findings.push({ code: "generation_warning", severity: "fatal", message: context.generationWarning });
    }
    if (context.extractionWarning) {
      quality.ok = false;
      if (!quality.findings.some((item) => item.code === "extraction_warning")) {
        quality.findings.push({ code: "extraction_warning", severity: "warn", message: context.extractionWarning });
      }
    }
    if (context.investmentAnalysisWarning) {
      quality.ok = false;
      quality.findings.push({ code: "investment_analysis_warning", severity: "warn", message: context.investmentAnalysisWarning });
    }
    return { ...context, report: stabilized, quality };
  }

  async function persistReport(context) {
    await repository.saveReport(context.job.id, context.report);
    const followupSuggestions = buildFollowupSuggestions({ analysis: context.analysis, quality: context.quality });
    let pdfStoragePath = context.job.pdfStoragePath || "";
    if (pdfReportService && typeof repository.savePdf === "function") {
      const pdf = await pdfReportService.render({
        title: `${context.job.companyName || (context.job.outputLanguage === "en" ? "Unnamed Company" : "未命名公司")} ${context.job.outputLanguage === "en" ? "BP Review Report" : "BP 核查报告"}`,
        markdown: context.report
      });
      pdfStoragePath = await repository.savePdf(context.job.id, pdf, { date: context.job.createdAt || now() });
    }
    const finalJob = {
      ...context.job,
      status: context.quality.ok ? "completed" : "needs_attention",
      reportAvailable: true,
      followupSuggestions,
      pdfStoragePath,
      quality: context.quality,
      sources: context.sources,
      analysis: context.analysis,
      businessAudit: context.businessAudit,
      claimLedger: context.claimLedger,
      evidenceManifest: context.evidenceManifest,
      investmentAnalysis: context.investmentAnalysis,
      researchPlan: context.framework,
      researchWarning: context.researchWarning || "",
      generationWarning: context.generationWarning || "",
      extractionWarning: context.extractionWarning || "",
      investmentAnalysisWarning: context.investmentAnalysisWarning || "",
      reanalysisInProgress: false,
      error: "",
      failedStep: "",
      upload: { ...context.job.upload, data: "" },
      completedAt: now()
    };
    await repository.save(finalJob);
    return { ...context, job: finalJob };
  }

  async function checkpoint(context, stepKey) {
    const artifact = checkpointArtifact(context, stepKey);
    const nextJob = {
      ...context.job,
      checkpoints: {
        ...(context.job.checkpoints || {}),
        [stepKey]: { completed: true, at: now(), artifact }
      }
    };
    context.job = await repository.save(nextJob);
  }

  function stageFor(key, status, message) {
    const index = steps.findIndex((step) => step.key === key);
    return stageEvent(steps[index], index, steps.length, status, message);
  }

  return { execute, steps: steps.map(({ key, label }) => ({ key, label })) };
}

export function createReviewJob({ companyName, instruction, outputLanguage = "zh", upload, steps, now = () => new Date().toISOString() }) {
  const createdAt = now();
  return {
    id: `bp_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    taskType: "attachment_review",
    companyName: String(companyName || "").trim(),
    title: `${String(companyName || "").trim() || "正在识别公司"} BP 核查`,
    instruction: String(instruction || "").trim(),
    outputLanguage: String(outputLanguage).toLowerCase().startsWith("en") ? "en" : "zh",
    pipelineVersion: BP_PIPELINE_VERSION,
    upload,
    status: "queued",
    stages: steps.map((step) => ({ ...step, status: "pending" })),
    checkpoints: {},
    messages: [],
    createdAt,
    updatedAt: createdAt
  };
}
