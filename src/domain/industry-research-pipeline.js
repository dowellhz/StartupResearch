import { randomUUID } from "node:crypto";
import { redactSensitiveText } from "../../public/privacy-redaction.js";
import { Result } from "./result.js";
import { planStructuredResearchTools } from "./research-tool-catalog.js";
import { normalizeEvidenceSources } from "./research-evidence-service.js";
import { completeStructuredJson } from "./structured-model-call.js";
import {
  buildIndustryFallback,
  buildIndustryPlanMessages,
  buildIndustryReportMessages,
  buildIndustrySynthesisMessages,
  resolveIndustryResearchTemplate
} from "./industry-research-prompts.js";
import { assessIndustryResearchQuality, stabilizeIndustryResearchReport } from "./industry-research-quality.js";

export function createIndustryResearchPipeline({ model, repository, pdfReportService, webResearchEnabled = true, now = () => new Date().toISOString() }) {
  const steps = [
    { key: "research-plan", label: "规划行业研究问题", run: planResearch },
    { key: "public-research", label: "检索行业与学术资料", run: collectSources },
    { key: "evidence-synthesis", label: "整理行业事实与分歧", run: synthesizeEvidence },
    { key: "report-generation", label: "撰写行业研究报告", run: generateReport },
    { key: "quality-gate", label: "检查结构、来源与引用", run: qualityGate },
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

  async function planResearch(context) {
    const selected = resolveIndustryResearchTemplate(context.job.researchTemplate);
    let planningWarning = "";
    let plan;
    try {
      plan = await completeStructuredJson({
        model,
        messages: buildIndustryPlanMessages({ topic: context.job.companyName, instruction: context.job.instruction, researchTemplate: context.job.researchTemplate }),
        signal: context.signal,
        maxTokens: 5000,
        validate: normalizePlan,
        onRetry: () => emit(context, "stage", stageFor("research-plan", "running", "研究规划格式异常，正在自动修复…"))
      });
    } catch (error) {
      if (context.signal?.aborted) throw error;
      planningWarning = `结构化规划降级：${error.message || error}`;
      plan = fallbackPlan(context.job.companyName, context.job.instruction, selected);
    }
    return { ...context, plan, planningWarning };
  }

  async function collectSources(context) {
    if (!webResearchEnabled || typeof model.webSearch !== "function") return { ...context, sources: [], researchWarning: "联网检索未启用" };
    const queries = context.plan.queryGroups.flatMap((group) => group.queries).slice(0, 10);
    const material = `${context.job.companyName} ${context.job.instruction} ${queries.join(" ")}`;
    try {
      const values = await model.webSearch({
        companyName: context.job.companyName,
        queries,
        requestedTools: unique(["general_web_search", ...planStructuredResearchTools(material)]),
        signal: context.signal,
        onToolCall: (tool) => emit(context, "stage", stageFor("public-research", "running", `正在调用 ${tool.label} 工具…`))
      });
      const sources = normalizeEvidenceSources(values).map((source) => ({ ...source, retrievedAt: source.retrievedAt || now() }));
      return { ...context, sources, researchWarning: sources.length ? "" : "检索完成，但未形成可引用来源" };
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return { ...context, sources: [], researchWarning: `行业资料检索降级：${error.message || error}` };
    }
  }

  async function synthesizeEvidence(context) {
    let synthesisWarning = "";
    let synthesis;
    try {
      synthesis = await completeStructuredJson({
        model,
        messages: buildIndustrySynthesisMessages({ topic: context.job.companyName, instruction: context.job.instruction, plan: context.plan, sources: context.sources }),
        signal: context.signal,
        maxTokens: 6000,
        validate: (value) => normalizeSynthesis(value, context.sources),
        onRetry: () => emit(context, "stage", stageFor("evidence-synthesis", "running", "证据结构异常，正在自动修复…"))
      });
    } catch (error) {
      if (context.signal?.aborted) throw error;
      synthesisWarning = `行业证据整理降级：${error.message || error}`;
      synthesis = fallbackSynthesis(context.sources, synthesisWarning);
    }
    return { ...context, synthesis, synthesisWarning };
  }

  async function generateReport(context) {
    const messages = buildIndustryReportMessages({
      topic: context.job.companyName,
      instruction: context.job.instruction,
      researchTemplate: context.job.researchTemplate,
      plan: context.plan,
      synthesis: context.synthesis,
      sources: context.sources,
      researchWarning: context.researchWarning
    });
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
      emit(context, "stage", stageFor("report-generation", "running", `报告输出异常，正在自动重试（${attempt}/2）…`));
    }
    const generationWarning = `行业研究报告输出异常：${lastError}`;
    const report = buildIndustryFallback({ topic: context.job.companyName, researchTemplate: context.job.researchTemplate, synthesis: context.synthesis, sources: context.sources, warning: generationWarning });
    emit(context, "report_delta", { delta: report });
    return { ...context, report, generationWarning };
  }

  async function qualityGate(context) {
    const report = stabilizeIndustryResearchReport(context.report, { topic: context.job.companyName, researchTemplate: context.job.researchTemplate, sources: context.sources });
    const warnings = [context.planningWarning, context.researchWarning, context.synthesisWarning, context.generationWarning];
    return { ...context, report, quality: assessIndustryResearchQuality(report, { researchTemplate: context.job.researchTemplate, sources: context.sources, synthesis: context.synthesis, warnings }) };
  }

  async function persistReport(context) {
    await repository.saveReport(context.job.id, context.report);
    let pdfStoragePath = context.job.pdfStoragePath || "";
    if (pdfReportService && repository.savePdf) {
      const pdf = await pdfReportService.render({ title: `${context.job.companyName} 行业研究报告`, markdown: context.report });
      pdfStoragePath = await repository.savePdf(context.job.id, pdf, { date: context.job.createdAt || now() });
    }
    const finalJob = { ...context.job, status: context.quality.ok ? "completed" : "needs_attention", reportAvailable: true, pdfStoragePath, quality: context.quality, sources: context.sources, analysis: context.synthesis, researchPlan: context.plan, researchWarning: context.researchWarning || "", generationWarning: context.generationWarning || "", extractionWarning: context.synthesisWarning || "", followupSuggestions: buildSuggestions(context), reanalysisInProgress: false, error: "", failedStep: "", completedAt: now() };
    await repository.save(finalJob);
    return { ...context, job: finalJob };
  }

  function stageFor(key, status, message) {
    const index = steps.findIndex((step) => step.key === key);
    return stageEvent(steps[index], index, steps.length, status, message);
  }

  return { execute, steps: steps.map(({ key, label }) => ({ key, label })) };
}

export function createIndustryResearchJob({ topic, instruction, researchTemplate, steps, now = () => new Date().toISOString() }) {
  const createdAt = now();
  const name = String(topic || "").trim();
  const selected = resolveIndustryResearchTemplate(researchTemplate);
  return { id: `industry_${randomUUID().replace(/-/g, "").slice(0, 20)}`, taskType: "industry_research", companyName: name, title: `${name} · ${selected.label}`, instruction: String(instruction || `完成${selected.label}`).trim(), researchTemplate: Object.entries(INDUSTRY_TEMPLATE_LABELS).find(([, label]) => label === selected.label)?.[0] || "industry_overview", upload: null, status: "queued", stages: steps.map((step) => ({ ...step, status: "pending" })), checkpoints: {}, messages: [], createdAt, updatedAt: createdAt };
}

const INDUSTRY_TEMPLATE_LABELS = { industry_overview: "行业概览", technical: "技术研究", commercial: "商业前景", investment: "投资价值" };

function normalizePlan(value) {
  const questions = array(value?.questions).slice(0, 12).map((item, index) => ({ id: String(item?.id || `q${index + 1}`), question: String(item?.question || "").trim(), importance: ["critical", "high", "medium", "low"].includes(item?.importance) ? item.importance : "medium", evidenceTypes: array(item?.evidenceTypes).map(String).slice(0, 6) })).filter((item) => item.question);
  const queryGroups = array(value?.queryGroups).slice(0, 8).map((item, index) => ({ id: String(item?.id || `g${index + 1}`), queries: array(item?.queries).map((query) => String(query || "").trim()).filter(Boolean).slice(0, 4), preferredSources: array(item?.preferredSources).map(String).slice(0, 6) })).filter((item) => item.queries.length);
  if (!questions.length || !queryGroups.length) throw new Error("行业研究规划缺少问题或查询组");
  return { objective: String(value?.objective || "").trim(), scope: value?.scope || {}, questions, queryGroups };
}

function fallbackPlan(topic, instruction, selected) {
  const sections = selected.sections.slice(0, 8);
  return { objective: `${selected.label}：${topic}`, scope: { included: sections }, questions: sections.map((section, index) => ({ id: `q${index + 1}`, question: `${topic}的${section}如何？`, importance: index < 3 ? "high" : "medium", evidenceTypes: ["官方资料", "权威研究"] })), queryGroups: sections.slice(0, 6).map((section, index) => ({ id: `g${index + 1}`, queries: [`${topic} ${section}`, instruction ? `${topic} ${instruction} ${section}` : ""].filter(Boolean), preferredSources: ["官方", "监管", "研究机构", "论文"] })) };
}

function normalizeSynthesis(value, sources) {
  const ids = new Set(sources.map((item) => item.id));
  return { findings: array(value?.findings).slice(0, 50).map((item) => ({ ...item, sourceIds: array(item?.sourceIds).map(String).filter((id) => ids.has(id)) })), risks: array(value?.risks).slice(0, 30), unknowns: array(value?.unknowns).map(String).slice(0, 30) };
}

function fallbackSynthesis(sources, warning) {
  return { findings: sources.slice(0, 20).map((source) => ({ domain: "公开资料", statement: source.snippet || source.title, sourceIds: [source.id], confidence: source.sourceTier === "primary" ? "high" : "medium", nature: "source_claim" })), risks: [{ description: "公开证据仍有限，关键市场数字和投资判断需继续核验" }], unknowns: [warning] };
}

function checkpointArtifact(context, key) {
  return ({ "research-plan": { plan: context.plan, planningWarning: context.planningWarning }, "public-research": { sources: context.sources, researchWarning: context.researchWarning }, "evidence-synthesis": { synthesis: context.synthesis, synthesisWarning: context.synthesisWarning }, "report-generation": { report: context.report, generationWarning: context.generationWarning }, "quality-gate": { report: context.report, quality: context.quality }, "persist-report": {} })[key] || {};
}

function buildSuggestions(context) {
  return unique([...(context.synthesis.unknowns || []), "这个行业最值得投资的价值链环节是什么？", "列出报告中最需要继续核验的关键数字", "哪些变化会推翻当前行业判断？"]).slice(0, 4);
}

function emit(context, type, data) {
  if (type === "stage" && Array.isArray(context.job?.stages)) context.job = { ...context.job, stages: context.job.stages.map((stage) => stage.key === data.key ? { ...stage, status: data.status, message: data.message, updatedAt: new Date().toISOString() } : stage) };
  context.onEvent?.({ type, data, at: new Date().toISOString() });
}

function stageEvent(step, index, total, status, message) { return { key: step.key, label: step.label, index, total, status, message }; }
function runningMessage(key) { return ({ "research-plan": "正在扩展研究问题、章节映射与检索组…", "public-research": "正在调用网页与学术工具检索资料…", "evidence-synthesis": "正在区分事实、来源观点、分歧和未知项…", "report-generation": "正在撰写带来源的行业研究报告…", "quality-gate": "正在检查章节、来源和引用边界…", "persist-report": "正在保存报告和 checkpoint…" })[key]; }
function completedMessage(key, context) {
  if (key === "research-plan") return `已形成 ${context.plan.questions.length} 个问题、${context.plan.queryGroups.length} 组查询`;
  if (key === "public-research") return context.sources.length ? `已整理 ${context.sources.length} 个来源` : context.researchWarning;
  if (key === "evidence-synthesis") return context.synthesisWarning || `已整理 ${context.synthesis.findings.length} 条行业事实`;
  if (key === "report-generation") return `报告已生成，共 ${context.report.length} 个字符`;
  if (key === "quality-gate") return `质量评分 ${context.quality.score}`;
  return "行业研究报告已保存，可下载 PDF";
}
function unique(values) { return Array.from(new Set(values.filter(Boolean))); }
function array(value) { return Array.isArray(value) ? value : []; }
