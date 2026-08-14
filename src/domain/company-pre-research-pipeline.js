import { randomUUID } from "node:crypto";
import { createPipelineRunner } from "./pipeline-runner.js";
import { planStructuredResearchTools } from "./research-tool-catalog.js";
import { normalizeEvidenceSources } from "./research-evidence-service.js";
import { normalizeResearchQuestions } from "./research-question-service.js";
import { completeStructuredJson } from "./structured-model-call.js";
import {
  buildCompanyResearchExtractionMessages,
  buildCompanyResearchFallback,
  buildCompanyResearchReportMessages
} from "./company-pre-research-prompts.js";
import { assessCompanyResearchQuality, stabilizeCompanyResearchReport } from "./company-pre-research-quality.js";
import { redactSensitiveText } from "../../public/privacy-redaction.js";

export function createCompanyPreResearchPipeline({ model, repository, pdfReportService, technologyResearchTool, comparableCompanyResearchTool, webResearchEnabled = true, now = () => new Date().toISOString() }) {
  const steps = [
    { key: "research-scope", label: "制定公开研究范围", run: createScope },
    { key: "public-research", label: "抓取公司公开信息", run: collectPublicSources },
    { key: "fact-extraction", label: "整理公开事实与风险", run: extractFacts },
    { key: "technology-research", label: "按需调用技术调研", run: researchTechnology },
    { key: "comparable-company-research", label: "研究国内外同类公司", run: researchComparableCompanies },
    { key: "report-generation", label: "撰写公司预研报告", run: generateReport },
    { key: "quality-gate", label: "检查来源与报告质量", run: qualityGate },
    { key: "persist-report", label: "保存报告与版本", run: persistReport }
  ];

  const runner = createPipelineRunner({
    steps,
    repository,
    prepareContext: (job, runtime) => ({ job: prepareJob(job, steps), ...runtime }),
    restoreContext: (context, step) => restoreCheckpoint(context, step.key),
    saveCheckpoint: async (context, step) => { await checkpoint(context, step.key); return context; },
    emitStage: (context, step, index, status, message) => emit(context, "stage", stageEvent(step, index, steps.length, status, message)),
    runningMessage,
    completedMessage,
    onComplete: (context) => emit(context, "report_complete", { report: context.report, quality: context.quality, status: context.job.status, sources: context.sources, followupSuggestions: context.job.followupSuggestions })
  });

  const execute = runner.execute;

  async function createScope(context) {
    const companyName = context.job.companyName;
    const instruction = context.job.instruction;
    const material = `${companyName} ${instruction}`;
    const queries = unique([
      `${companyName} 官网 公司 产品 团队`,
      `${companyName} 法定主体 成立 股东 融资`,
      `${companyName} 创始人 高管 履历`,
      `${companyName} 客户 合作 采购 中标`,
      `${companyName} 融资 投资方`,
      `${companyName} 市场 竞品 技术`,
      instruction ? `${companyName} ${instruction}` : ""
    ]).slice(0, 8);
    return {
      ...context,
      scope: {
        queries,
        requestedTools: unique(["general_web_search", ...planStructuredResearchTools(material)]),
        domains: ["主体", "产品与技术", "团队", "市场与竞争", "客户与商业", "融资", "风险"]
      }
    };
  }

  async function collectPublicSources(context) {
    if (!webResearchEnabled || typeof model.webSearch !== "function") {
      return { ...context, sources: [], researchWarning: "联网检索未启用" };
    }
    try {
      const values = await model.webSearch({
        companyName: context.job.companyName,
        queries: context.scope.queries,
        requestedTools: context.scope.requestedTools,
        signal: context.signal,
        onToolCall: (tool) => emit(context, "stage", stageFor("public-research", "running", `正在调用 ${tool.label} 工具…`))
      });
      const sources = normalizeEvidenceSources(values).map((source) => ({ ...source, retrievedAt: source.retrievedAt || now() }));
      return {
        ...context,
        sources,
        researchWarning: sources.length ? "" : "公开信息抓取已完成，但本次未形成可引用来源"
      };
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return { ...context, sources: [], researchWarning: `公开信息抓取降级：${error.message || error}` };
    }
  }

  async function extractFacts(context) {
    let analysis;
    let extractionWarning = "";
    try {
      analysis = await completeStructuredJson({
        model,
        messages: buildCompanyResearchExtractionMessages({
          companyName: context.job.companyName,
          instruction: context.job.instruction,
          outputLanguage: context.job.outputLanguage,
          sources: context.sources
        }),
        signal: context.signal,
        maxTokens: 6000,
        validate: (value) => validateAnalysis(value, context.sources),
        onRetry: () => emit(context, "stage", stageFor("fact-extraction", "running", "结构化公开事实格式异常，正在自动修复并重试（2/2）…"))
      });
    } catch (error) {
      if (context.signal?.aborted) throw error;
      extractionWarning = `公开事实结构化连续两次异常：${error.message || error}`;
      analysis = fallbackAnalysis(context, extractionWarning);
    }
    return { ...context, analysis, extractionWarning };
  }

  async function researchTechnology(context) {
    if (!technologyResearchTool) return { ...context, technologyResearch: { invoked: false }, technologyResearchWarning: "" };
    const value = await technologyResearchTool.research({
      companyName: context.job.companyName,
      instruction: context.job.instruction,
      outputLanguage: context.job.outputLanguage,
      analysis: context.analysis,
      existingSources: context.sources
    }, {
      signal: context.signal,
      onToolCall: (tool) => emit(context, "stage", stageFor("technology-research", "running", `技术调研正在调用 ${tool.label} 工具…`))
    });
    const sources = normalizeEvidenceSources([...context.sources, ...(value.additionalSources || [])]);
    const { additionalSources: _additionalSources, warning, ...technologyResearch } = value;
    const technologyResearchWarning = warning || "";
    return {
      ...context,
      sources,
      technologyResearch: { ...technologyResearch, warning: technologyResearchWarning },
      technologyResearchWarning
    };
  }

  async function researchComparableCompanies(context) {
    if (!comparableCompanyResearchTool) return { ...context, comparableCompanyResearch: { invoked: false }, comparableCompanyResearchWarning: "" };
    const value = await comparableCompanyResearchTool.research({
      companyName: context.job.companyName,
      instruction: context.job.instruction,
      outputLanguage: context.job.outputLanguage,
      analysis: context.analysis,
      technologyResearch: context.technologyResearch,
      existingSources: context.sources
    }, {
      signal: context.signal,
      onToolCall: (tool) => emit(context, "stage", stageFor("comparable-company-research", "running", `同类公司研究正在调用 ${tool.label} 工具…`))
    });
    const sources = normalizeEvidenceSources([...context.sources, ...(value.additionalSources || [])]);
    const { additionalSources: _additionalSources, warning, ...comparableCompanyResearch } = value;
    const comparableCompanyResearchWarning = warning || "";
    return {
      ...context,
      sources,
      comparableCompanyResearch: { ...comparableCompanyResearch, warning: comparableCompanyResearchWarning },
      comparableCompanyResearchWarning
    };
  }

  async function generateReport(context) {
    const messages = buildCompanyResearchReportMessages({
      companyName: context.job.companyName,
      instruction: context.job.instruction,
      outputLanguage: context.job.outputLanguage,
      scope: context.scope,
      analysis: context.analysis,
      technologyResearch: context.technologyResearch,
      comparableCompanyResearch: context.comparableCompanyResearch,
      sources: context.sources,
      researchWarning: context.researchWarning
    });
    let lastError = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let streamed = "";
      let visible = false;
      try {
        const report = await model.stream(messages, {
          signal: context.signal,
          maxTokens: 10000,
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
      ? `Company research report generation failed: ${lastError}. A recoverable report was created from public sources and structured results.`
      : `公司预研报告输出异常：${lastError}。已使用公开来源与结构化结果生成可恢复报告。`;
    const report = redactSensitiveText(buildCompanyResearchFallback({
      companyName: context.job.companyName,
      analysis: context.analysis,
      technologyResearch: context.technologyResearch,
      comparableCompanyResearch: context.comparableCompanyResearch,
      sources: context.sources,
      warning: generationWarning,
      outputLanguage: context.job.outputLanguage
    }));
    emit(context, "report_delta", { delta: report });
    return { ...context, report, generationWarning };
  }

  async function qualityGate(context) {
    const report = stabilizeCompanyResearchReport(context.report, {
      companyName: context.job.companyName,
      outputLanguage: context.job.outputLanguage,
      sources: context.sources,
      analysis: context.analysis
    });
    const quality = assessCompanyResearchQuality(report, {
      outputLanguage: context.job.outputLanguage,
      sources: context.sources,
      analysis: context.analysis,
      researchWarning: context.researchWarning,
      generationWarning: context.generationWarning
    });
    if (context.extractionWarning) {
      quality.ok = false;
      quality.findings.push({ code: "extraction_warning", severity: "warn", message: context.extractionWarning });
    }
    if (context.comparableCompanyResearchWarning) {
      quality.ok = false;
      quality.findings.push({ code: "comparable_company_research_warning", severity: "warn", message: context.comparableCompanyResearchWarning });
    }
    return { ...context, report, quality };
  }

  async function persistReport(context) {
    await repository.saveReport(context.job.id, context.report);
    const finalJob = {
      ...context.job,
      status: context.quality.ok ? "completed" : "needs_attention",
      reportAvailable: true,
      followupSuggestions: buildSuggestions(context.analysis),
      pdfStoragePath: "",
      quality: context.quality,
      sources: context.sources,
      analysis: context.analysis,
      researchPlan: context.scope,
      technologyResearch: context.technologyResearch || { invoked: false },
      technologyResearchWarning: context.technologyResearchWarning || "",
      comparableCompanyResearch: context.comparableCompanyResearch || { invoked: false },
      comparableCompanyResearchWarning: context.comparableCompanyResearchWarning || "",
      researchWarning: context.researchWarning || "",
      generationWarning: context.generationWarning || "",
      extractionWarning: context.extractionWarning || "",
      reanalysisInProgress: false,
      error: "",
      failedStep: "",
      completedAt: now()
    };
    await repository.save(finalJob);
    return { ...context, job: finalJob };
  }

  async function checkpoint(context, stepKey) {
    context.job = await repository.save({
      ...context.job,
      checkpoints: {
        ...(context.job.checkpoints || {}),
        [stepKey]: { completed: true, at: now(), artifact: checkpointArtifact(context, stepKey) }
      }
    });
  }

  function stageFor(key, status, message) {
    const index = steps.findIndex((step) => step.key === key);
    return stageEvent(steps[index], index, steps.length, status, message);
  }

  return { execute, steps: steps.map(({ key, label }) => ({ key, label })) };
}

export function createCompanyPreResearchJob({ companyName, instruction, outputLanguage = "zh", steps, now = () => new Date().toISOString() }) {
  const createdAt = now();
  const name = String(companyName || "").trim();
  return {
    id: `research_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    taskType: "company_pre_research",
    companyName: name,
    title: `${name} 公司预研`,
    instruction: String(instruction || "基于公开信息完成公司预研").trim(),
    outputLanguage: String(outputLanguage).toLowerCase().startsWith("en") ? "en" : "zh",
    upload: null,
    status: "queued",
    stages: steps.map((step) => ({ ...step, status: "pending" })),
    checkpoints: {},
    messages: [],
    createdAt,
    updatedAt: createdAt
  };
}

function checkpointArtifact(context, stepKey) {
  return ({
    "research-scope": { scope: context.scope },
    "public-research": { sources: context.sources, researchWarning: context.researchWarning },
    "fact-extraction": { analysis: context.analysis, extractionWarning: context.extractionWarning },
    "technology-research": { sources: context.sources, technologyResearch: context.technologyResearch, technologyResearchWarning: context.technologyResearchWarning },
    "comparable-company-research": { sources: context.sources, comparableCompanyResearch: context.comparableCompanyResearch, comparableCompanyResearchWarning: context.comparableCompanyResearchWarning },
    "report-generation": { report: context.report, generationWarning: context.generationWarning },
    "quality-gate": { report: context.report, quality: context.quality },
    "persist-report": {}
  })[stepKey] || {};
}

function restoreCheckpoint(context, stepKey) {
  return { ...context, ...(context.job.checkpoints[stepKey].artifact || {}) };
}

function validateAnalysis(value, sources = []) {
  const sourceIds = new Set(sources.map((item) => item.id));
  const findings = array(value?.findings).map((finding, index) => ({
    ...finding,
    id: String(finding?.id || `finding_${index + 1}`),
    sourceIds: array(finding?.sourceIds).map(String).filter((id) => !sourceIds.size || sourceIds.has(id))
  }));
  return { ...value, findings, risks: array(value?.risks), missingInformation: array(value?.missingInformation), followupQuestions: normalizeResearchQuestions(value?.followupQuestions) };
}

function fallbackAnalysis(context, warning) {
  const english = context.job.outputLanguage === "en";
  return {
    companyProfile: { legalName: context.job.companyName },
    findings: context.sources.slice(0, 12).map((source, index) => ({
      id: `finding_${index + 1}`,
      domain: english ? "Public Sources" : "公开资料",
      statement: source.snippet || source.title,
      sourceIds: [source.id],
      confidence: source.sourceTier === "primary" ? "high" : "medium",
      nature: "third_party_report"
    })),
    risks: [{ category: english ? "Data Quality" : "数据质量", description: english ? "Structured public-fact extraction did not complete; verify each point against the original sources." : "公开事实结构化未完整完成，需结合来源原文复核", basisSourceIds: [], severity: "medium", nextStep: english ? "Open and verify each source" : "逐条打开来源复核" }],
    missingInformation: [warning],
    followupQuestions: [english ? "Which primary records can verify the legal entity, core team, customers, financials, and financing history?" : "法定主体、核心团队、客户、财务和融资历史分别有哪些可验证底层材料？"]
  };
}

function buildSuggestions(analysis = {}) {
  return unique([
    ...normalizeResearchQuestions(analysis.followupQuestions),
    "基于现有公开资料，最需要公司补证的三项是什么？",
    "把公开信息中的风险按投资否决优先级排序"
  ]).slice(0, 4);
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
  return ({
    "research-scope": "正在把公司名称和关注方向拆解为公开信息查询…",
    "public-research": "正在调用公开网页与专项数据工具抓取公司信息…",
    "fact-extraction": "正在区分公开事实、公司自述、第三方报道和分析推断…",
    "technology-research": "正在判断公司核心技术是否需要专项调研，并按需调用论文与技术数据库…",
    "comparable-company-research": "正在定义可比口径并分别研究国内、海外同类公司与替代方案…",
    "report-generation": "正在基于公开来源撰写公司预研报告…",
    "quality-gate": "正在检查报告章节、来源和引用范围…",
    "persist-report": "正在保存报告与可恢复 checkpoint…"
  })[key];
}

function completedMessage(key, context) {
  if (key === "research-scope") return `已生成 ${context.scope.queries.length} 个查询并选择 ${context.scope.requestedTools.length} 个检索工具`;
  if (key === "public-research") return context.sources.length ? `已整理 ${context.sources.length} 个公开来源` : context.researchWarning;
  if (key === "fact-extraction") return context.extractionWarning || `已整理 ${context.analysis.findings.length} 条公开事实与线索`;
  if (key === "technology-research") return context.technologyResearch?.invoked
    ? context.technologyResearchWarning || `技术调研 Tool 已完成：${context.technologyResearch.plan?.topic || "核心技术"}`
    : context.technologyResearchWarning || "未识别出需要专项调研的核心技术";
  if (key === "comparable-company-research") return context.comparableCompanyResearch?.invoked
    ? context.comparableCompanyResearchWarning || `已形成 ${peerCount(context.comparableCompanyResearch)} 个有来源支持的同类公司对照`
    : context.comparableCompanyResearchWarning || "现有信息不足以定义可靠的可比公司口径";
  if (key === "report-generation") return `报告正文已生成，共 ${context.report.length} 个字符`;
  if (key === "quality-gate") return `质量评分 ${context.quality.score}，${context.quality.findings.length} 个提示`;
  if (key === "persist-report") return "公司预研报告已保存，可下载 PDF";
  return "已完成";
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function peerCount(value) {
  return ["domesticPeers", "internationalPeers", "alternatives"]
    .reduce((total, key) => total + array(value?.synthesis?.[key]).length, 0);
}

function prepareJob(job, steps) {
  const checkpoints = { ...(job.checkpoints || {}) };
  for (const requiredKey of ["technology-research", "comparable-company-research"]) {
    const index = steps.findIndex((step) => step.key === requiredKey);
    if (!checkpoints[requiredKey]?.completed && index >= 0) {
      for (const step of steps.slice(index + 1)) delete checkpoints[step.key];
    }
  }
  const existing = new Map(array(job.stages).map((stage) => [stage.key, stage]));
  return {
    ...job,
    checkpoints,
    stages: steps.map((step) => {
      const metadata = { key: step.key, label: step.label };
      const current = existing.get(step.key);
      if (checkpoints[step.key]?.completed) return { ...metadata, ...current, status: "completed" };
      return current ? { ...metadata, ...current } : { ...metadata, status: "pending" };
    })
  };
}
