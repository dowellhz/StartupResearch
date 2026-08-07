import { summarizeInvestmentAnalysis } from "./investment-analysis-service.js";

export const BP_PIPELINE_VERSION = 2;

export function prepareJobForPipeline(job, steps) {
  const existingStages = new Map((Array.isArray(job?.stages) ? job.stages : []).map((stage) => [stage.key, stage]));
  const checkpoints = { ...(job?.checkpoints || {}) };
  const evidenceIndex = steps.findIndex((step) => step.key === "evidence-verification");
  if (!checkpoints["evidence-verification"]?.completed && evidenceIndex >= 0) {
    for (const step of steps.slice(evidenceIndex + 1)) delete checkpoints[step.key];
  }
  return {
    ...job,
    pipelineVersion: BP_PIPELINE_VERSION,
    checkpoints,
    stages: steps.map((step) => {
      const existing = existingStages.get(step.key);
      const metadata = { key: step.key, label: step.label };
      if (checkpoints[step.key]?.completed) return { ...metadata, ...existing, status: "completed" };
      return existing ? { ...metadata, ...existing } : { ...metadata, status: "pending" };
    })
  };
}

export function checkpointArtifact(context, stepKey) {
  const artifacts = {
    "document-parse": { document: context.document, upload: context.job.upload },
    "claim-extraction": { analysis: context.analysis, companyIdentity: context.companyIdentity, extractionWarning: context.extractionWarning },
    "business-audit": { businessAudit: context.businessAudit },
    "review-framework": { framework: context.framework },
    "public-research": { sources: context.sources, researchWarning: context.researchWarning },
    "cross-check": { crossCheck: context.crossCheck, claimLedger: context.claimLedger },
    "evidence-verification": { evidenceManifest: context.evidenceManifest, claimLedger: context.claimLedger },
    "investment-analysis": { investmentAnalysis: context.investmentAnalysis, investmentAnalysisWarning: context.investmentAnalysisWarning },
    "report-generation": { report: context.report },
    "quality-gate": { report: context.report, quality: context.quality },
    "persist-report": {}
  };
  return artifacts[stepKey] || {};
}

export function restoreCheckpoint(context, stepKey) {
  return { ...context, ...(context.job.checkpoints[stepKey].artifact || {}) };
}

export function validateAnalysis(analysis) {
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

export function fallbackAnalysis(context, warning) {
  const companyName = context.job.companyName || "";
  const english = context.job.outputLanguage === "en";
  return {
    companyProfile: { companyName },
    claims: [],
    businessAudit: { metrics: [], checks: [], assumptions: [] },
    risks: [{
      category: english ? "Data Quality" : "数据质量",
      description: english
        ? "Structured claim extraction did not produce valid JSON; verify the report against the original BP."
        : "结构化声明提取未形成有效 JSON，报告需结合 BP 原文复核",
      severity: "high",
      basis: warning
    }],
    searchQueries: companyName ? [`${companyName} 公司 团队 产品 融资`] : [],
    missingInformation: [english ? "The structured key-claims list requires manual verification." : "结构化关键声明清单需人工复核"],
    warning
  };
}

export function assessDetectedCompanyIdentity({ providedCompanyName, instruction, documentText, profile = {} }) {
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

export function joinWarnings(...values) {
  return values.map((value) => String(value || "").trim()).filter(Boolean).join("；");
}

export function emit(context, type, data) {
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

export function stageEvent(step, index, total, status, message) {
  return { key: step.key, label: step.label, index, total, status, message };
}

export function runningMessage(key) {
  return {
    "document-parse": "正在读取文件文本层并整理页面结构…",
    "claim-extraction": "DeepSeek 正在提取关键事实、数字与商业假设…",
    "business-audit": "正在复算 BP 数字关系并识别经营预测中的关键假设…",
    "review-framework": "正在为高优先级声明分配核验目标与搜索查询…",
    "public-research": "DeepSeek Agentic Search 正在检索公司、团队、市场、竞争及专项数据库…",
    "cross-check": "正在区分公开支持、冲突、自述与资料不足…",
    "evidence-verification": "正在逐条核对 BP 原文、页码和网页证据指纹…",
    "investment-analysis": "正在重建市场规模、竞品矩阵、投资判断并比较 BP 版本…",
    "report-generation": "DeepSeek 正在撰写完整核查报告…",
    "quality-gate": "正在检查章节、证据标记和核查表完整性…",
    "persist-report": "正在保存报告与可恢复 checkpoint…"
  }[key];
}

export function completedMessage(key, context) {
  if (key === "document-parse") return `已解析 ${context.document.pageCount || "未知"} 页，${context.document.originalChars} 个字符`;
  if (key === "claim-extraction") return context.extractionWarning || `已提取 ${context.analysis.claims.length} 条关键声明`;
  if (key === "business-audit") return context.businessAudit.summary.metricCount
    ? `已整理 ${context.businessAudit.summary.metricCount} 个指标并完成 ${context.businessAudit.summary.checkCount} 项复算检查`
    : "BP 未形成可复算的结构化数字，已保留待补信息";
  if (key === "review-framework") return `已覆盖 ${context.framework.domains.length} 个核查维度，为 ${context.framework.claimPlans.length} 条声明建立研究计划`;
  if (key === "public-research") return context.sources.length ? `已收集 ${context.sources.length} 个公开来源` : (context.researchWarning || "未形成公开来源");
  if (key === "cross-check") return `已生成 ${context.claimLedger.summary.total} 张声明证据卡，其中 ${context.claimLedger.summary.supported} 条获公开支持`;
  if (key === "evidence-verification") return context.evidenceManifest.quality.warning
    || `已核验 ${context.evidenceManifest.summary.traceableDocumentClaims} 条 BP 原文引用`;
  if (key === "investment-analysis") {
    const summary = summarizeInvestmentAnalysis(context.investmentAnalysis) || {};
    return context.investmentAnalysisWarning || `已形成 ${summary.competitorCount || 0} 个竞品对照、${summary.vetoCount || 0} 个否决条件和 ${summary.versionChangeCount || 0} 项版本变化`;
  }
  if (key === "report-generation") return `报告正文已生成，共 ${context.report.length} 个字符`;
  if (key === "quality-gate") return `质量评分 ${context.quality.score}，${context.quality.findings.length} 个提示`;
  if (key === "persist-report") return "报告已保存，可下载 PDF";
  return "已完成";
}

function normalizeDetectedCompanyName(value) {
  const name = String(value || "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (/^(未提供|未识别|未知|unknown|n\/a|null)$/i.test(name)) return "";
  return name;
}

function normalizeComparable(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}
