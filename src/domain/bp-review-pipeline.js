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

export function createBpReviewPipeline({ extractor, model, repository, pdfReportService, investmentAnalysisService, webResearchEnabled = true, now = () => new Date().toISOString() }) {
  const steps = [
    { key: "document-parse", label: "解析商业计划书", run: parseDocument },
    { key: "claim-extraction", label: "提取关键声明与假设", run: extractClaims },
    { key: "business-audit", label: "审计数字与经营假设", run: auditBusinessClaims },
    { key: "review-framework", label: "建立核查框架", run: buildFramework },
    { key: "public-research", label: "检索公开资料", run: collectPublicSources },
    { key: "cross-check", label: "交叉核查与风险研判", run: crossCheck },
    { key: "investment-analysis", label: "形成投资分析与版本比较", run: analyzeInvestment },
    { key: "report-generation", label: "撰写研究报告", run: generateReport },
    { key: "quality-gate", label: "报告质量检查", run: qualityGate },
    { key: "persist-report", label: "保存报告与版本", run: persistReport }
  ];

  async function execute(job, { onEvent = () => {}, signal } = {}) {
    let context = { job, signal, onEvent };
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
      crossCheck: context.crossCheck
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
      companyIdentity: context.companyIdentity || context.job.companyIdentity
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
    upload,
    status: "queued",
    stages: steps.map((step) => ({ ...step, status: "pending" })),
    checkpoints: {},
    messages: [],
    createdAt,
    updatedAt: createdAt
  };
}

function checkpointArtifact(context, stepKey) {
  const artifacts = {
    "document-parse": { document: context.document, upload: context.job.upload },
    "claim-extraction": { analysis: context.analysis, companyIdentity: context.companyIdentity, extractionWarning: context.extractionWarning },
    "business-audit": { businessAudit: context.businessAudit },
    "review-framework": { framework: context.framework },
    "public-research": { sources: context.sources, researchWarning: context.researchWarning },
    "cross-check": { crossCheck: context.crossCheck, claimLedger: context.claimLedger },
    "investment-analysis": { investmentAnalysis: context.investmentAnalysis, investmentAnalysisWarning: context.investmentAnalysisWarning },
    "report-generation": { report: context.report },
    "quality-gate": { report: context.report, quality: context.quality },
    "persist-report": {}
  };
  return artifacts[stepKey] || {};
}

function restoreCheckpoint(context, stepKey) {
  return { ...context, ...(context.job.checkpoints[stepKey].artifact || {}) };
}

function validateAnalysis(analysis) {
  if (!Array.isArray(analysis.claims)) throw new Error("模型未返回关键声明列表");
  const usedIds = new Set();
  const claims = analysis.claims.map((claim, index) => {
    let id = String(claim?.id || `claim_${index + 1}`).trim();
    if (!id || usedIds.has(id)) id = `claim_${index + 1}`;
    usedIds.add(id);
    return { ...claim, id };
  });
  return { ...analysis, claims };
}

function fallbackAnalysis(context, warning) {
  const companyName = context.job.companyName || "";
  const english = context.job.outputLanguage === "en";
  return {
    companyProfile: { companyName },
    claims: [],
    businessAudit: { metrics: [], checks: [], assumptions: [] },
    risks: [{ category: english ? "Data Quality" : "数据质量", description: english ? "Structured claim extraction did not produce valid JSON; verify the report against the original BP." : "结构化声明提取未形成有效 JSON，报告需结合 BP 原文复核", severity: "high", basis: warning }],
    searchQueries: companyName ? [`${companyName} 公司 团队 产品 融资`] : [],
    missingInformation: [english ? "The structured key-claims list requires manual verification." : "结构化关键声明清单需人工复核"],
    warning
  };
}

function normalizeDetectedCompanyName(value) {
  const name = String(value || "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (/^(未提供|未识别|未知|unknown|n\/a|null)$/i.test(name)) return "";
  return name;
}

function assessDetectedCompanyIdentity({ providedCompanyName, instruction, documentText, profile = {} }) {
  const provided = normalizeDetectedCompanyName(providedCompanyName);
  const detectedName = normalizeDetectedCompanyName(profile?.companyName);
  const evidence = Array.isArray(profile?.companyNameEvidence)
    ? profile.companyNameEvidence.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6)
    : String(profile?.companyNameEvidence || "").trim() ? [String(profile.companyNameEvidence).trim()] : [];
  const declaredConfidence = ["high", "medium", "low"].includes(profile?.companyNameConfidence) ? profile.companyNameConfidence : "low";
  const appearsInDocument = detectedName && String(documentText || "").slice(0, 12000).includes(detectedName);
  const instructionCollision = detectedName && normalizeComparable(detectedName) === normalizeComparable(instruction);
  const confidence = declaredConfidence === "high" || declaredConfidence === "medium"
    ? declaredConfidence
    : appearsInDocument ? "medium" : "low";
  const namesAgree = provided && detectedName && normalizeComparable(provided) === normalizeComparable(detectedName);
  const providedAppearsInDocument = provided && String(documentText || "").slice(0, 12000).includes(provided);
  const providedMatch = profile?.providedCompanyNameMatch === true
    ? true
    : profile?.providedCompanyNameMatch === false ? false : "uncertain";
  const acceptProvided = provided && (providedMatch === true || namesAgree || providedAppearsInDocument && providedMatch !== false);
  const acceptDetected = detectedName && !instructionCollision && confidence !== "low" && (evidence.length || appearsInDocument);
  const acceptedName = acceptProvided ? provided : acceptDetected ? detectedName : "";
  const acceptedConfidence = acceptProvided
    ? providedMatch === true || namesAgree ? "high" : "medium"
    : acceptDetected ? confidence : "low";
  return {
    acceptedName,
    detectedName,
    providedName: provided,
    providedNameMatch: providedMatch,
    confidence: acceptedConfidence,
    evidence: evidence.length ? evidence : appearsInDocument ? ["公司名称出现在 BP 原文中"] : providedAppearsInDocument ? ["用户填写名称出现在 BP 原文中"] : [],
    source: acceptProvided ? "user-verified-by-bp" : "bp",
    warning: acceptedName
      ? provided && !acceptProvided ? `用户填写名称“${provided}”与 BP 主体不一致，已采用 BP 识别结果` : ""
      : detectedName ? "公司名称证据不足，未自动采用" : "未从 BP 中可靠识别公司名称"
  };
}

function normalizeComparable(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}

function joinWarnings(...values) {
  return values.map((value) => String(value || "").trim()).filter(Boolean).join("；");
}

function emit(context, type, data) {
  if (type === "stage" && Array.isArray(context.job?.stages)) {
    context.job = {
      ...context.job,
      stages: context.job.stages.map((stage) => stage.key === data.key
        ? { ...stage, status: data.status, message: data.message, updatedAt: new Date().toISOString() }
        : stage)
    };
  }
  context.onEvent?.({ type, data, at: new Date().toISOString() });
}

function stageEvent(step, index, total, status, message) {
  return { key: step.key, label: step.label, index, total, status, message };
}

function runningMessage(key) {
  return {
    "document-parse": "正在读取文件文本层并整理页面结构…",
    "claim-extraction": "DeepSeek 正在提取关键事实、数字与商业假设…",
    "business-audit": "正在复算 BP 数字关系并识别经营预测中的关键假设…",
    "review-framework": "正在为高优先级声明分配核验目标与搜索查询…",
    "public-research": "DeepSeek Agentic Search 正在检索公司、团队、市场、竞争及专项数据库…",
    "cross-check": "正在区分公开支持、冲突、自述与资料不足…",
    "investment-analysis": "正在重建市场规模、竞品矩阵、投资判断并比较 BP 版本…",
    "report-generation": "DeepSeek 正在撰写完整核查报告…",
    "quality-gate": "正在检查章节、证据标记和核查表完整性…",
    "persist-report": "正在保存报告与可恢复 checkpoint…"
  }[key];
}

function completedMessage(key, context) {
  if (key === "document-parse") return `已解析 ${context.document.pageCount || "未知"} 页，${context.document.originalChars} 个字符`;
  if (key === "claim-extraction") return context.extractionWarning || `已提取 ${context.analysis.claims.length} 条关键声明`;
  if (key === "business-audit") return context.businessAudit.summary.metricCount
    ? `已整理 ${context.businessAudit.summary.metricCount} 个指标并完成 ${context.businessAudit.summary.checkCount} 项复算检查`
    : "BP 未形成可复算的结构化数字，已保留待补信息";
  if (key === "review-framework") return `已覆盖 ${context.framework.domains.length} 个核查维度，为 ${context.framework.claimPlans.length} 条声明建立研究计划`;
  if (key === "public-research") return context.sources.length ? `已收集 ${context.sources.length} 个公开来源` : (context.researchWarning || "未形成公开来源");
  if (key === "cross-check") return `已生成 ${context.claimLedger.summary.total} 张声明证据卡，其中 ${context.claimLedger.summary.supported} 条获公开支持`;
  if (key === "investment-analysis") {
    const summary = summarizeInvestmentAnalysis(context.investmentAnalysis) || {};
    return context.investmentAnalysisWarning || `已形成 ${summary.competitorCount || 0} 个竞品对照、${summary.vetoCount || 0} 个否决条件和 ${summary.versionChangeCount || 0} 项版本变化`;
  }
  if (key === "report-generation") return `报告正文已生成，共 ${context.report.length} 个字符`;
  if (key === "quality-gate") return `质量评分 ${context.quality.score}，${context.quality.findings.length} 个提示`;
  if (key === "persist-report") return "报告已保存，可下载 PDF";
  return "已完成";
}
