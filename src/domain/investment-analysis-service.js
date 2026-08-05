import { completeStructuredJson } from "./structured-model-call.js";

const MARKET_STATUSES = new Set(["reconstructed", "partial", "not_calculable"]);
const CONFIDENCE_LEVELS = new Set(["high", "medium", "low"]);
const DECISION_LEVELS = new Set(["positive", "conditional", "negative", "insufficient"]);

export function createInvestmentAnalysisService({ model }) {
  if (!model?.complete) throw new Error("investment analysis requires a structured model");

  async function analyze(input, { signal, onRetry = () => {} } = {}) {
    input ||= {};
    try {
      const value = await completeStructuredJson({
        model,
        messages: buildInvestmentAnalysisMessages(input),
        signal,
        maxTokens: 6000,
        validate: (value) => constrainInvestmentAnalysis(value, input),
        onRetry
      });
      return { value, warning: "" };
    } catch (error) {
      if (signal?.aborted) throw error;
      return {
        value: emptyInvestmentAnalysis(Boolean(input?.previousAnalysisSnapshot)),
        warning: `投资分析结构化输出连续两次异常：${error.message || error}。已保留其他核查结果，可单独重试本阶段。`
      };
    }
  }

  return { analyze };
}

export function normalizeInvestmentAnalysis(value = {}) {
  value ||= {};
  return {
    marketSizing: normalizeMarketSizing(value.marketSizing),
    competitorMatrix: normalizeCompetitorMatrix(value.competitorMatrix),
    decision: normalizeDecision(value.decision),
    versionComparison: normalizeVersionComparison(value.versionComparison)
  };
}

export function emptyInvestmentAnalysis(hasPreviousVersion = false) {
  return {
    marketSizing: { status: "not_calculable", method: "", formula: "", inputs: [], scenarios: [], gaps: [], sourceIds: [] },
    competitorMatrix: { dimensions: [], rows: [], gaps: [] },
    decision: { stance: "insufficient", thesis: [], antiThesis: [], keyAssumptions: [], vetoItems: [], milestones: [], nextSteps: [] },
    versionComparison: { available: hasPreviousVersion, summary: hasPreviousVersion ? "新版差异暂未形成结构化结果" : "首次核查，无历史 BP 可比", changes: [] }
  };
}

export function summarizeInvestmentAnalysis(value) {
  if (!value) return null;
  return {
    marketStatus: value.marketSizing?.status || "not_calculable",
    competitorCount: value.competitorMatrix?.rows?.length || 0,
    stance: value.decision?.stance || "insufficient",
    vetoCount: value.decision?.vetoItems?.length || 0,
    versionChangeCount: value.versionComparison?.changes?.length || 0
  };
}

function constrainInvestmentAnalysis(value, input) {
  const result = normalizeInvestmentAnalysis(value);
  const allowed = new Set(array(input?.sources).map((source) => text(source?.id, 100)).filter(Boolean));
  const prune = (values) => array(values).filter((id) => allowed.has(id));
  result.marketSizing.sourceIds = prune(result.marketSizing.sourceIds);
  for (const item of result.marketSizing.inputs) item.sourceIds = prune(item.sourceIds);
  for (const item of result.marketSizing.scenarios) item.sourceIds = prune(item.sourceIds);
  for (const item of result.competitorMatrix.rows) item.sourceIds = prune(item.sourceIds);
  for (const item of result.decision.vetoItems) item.sourceIds = prune(item.sourceIds);
  const hasPrevious = Boolean(input?.previousAnalysisSnapshot);
  result.versionComparison.available = hasPrevious;
  if (!hasPrevious) {
    result.versionComparison.summary = "首次核查，无历史 BP 可比";
    result.versionComparison.changes = [];
  }
  return result;
}

function buildInvestmentAnalysisMessages(input = {}) {
  return [
    {
      role: "system",
      content: [
        "你是风险投资团队的结构化投资分析师，只输出合法 JSON。",
        "输入只包含 BP 自述、公开证据和确定性复算结果；不得发明数字、竞品、来源或历史变化。",
        "输出格式：{marketSizing,competitorMatrix,decision,versionComparison}。",
        "marketSizing 包含 status、method、formula、inputs、scenarios、gaps、sourceIds；status 只能是 reconstructed、partial、not_calculable。",
        "市场测算优先自下而上。inputs 每项包含 name、value、unit、origin、sourceIds；origin 只能写 BP、公开来源、分析假设。scenarios 每项包含 name、result、formula、assumptions、sourceIds。无法测算时保留 gaps，不得补数。",
        "competitorMatrix 包含 dimensions、rows、gaps；rows 每项包含 name、relationship、values、sourceIds、confidence。只列 BP 或公开来源中出现的企业/替代方案。",
        "decision 包含 stance、thesis、antiThesis、keyAssumptions、vetoItems、milestones、nextSteps；stance 只能是 positive、conditional、negative、insufficient。每个 vetoItems 包含 condition、basis、verification、sourceIds，不得把资料缺失直接定性为造假。",
        "versionComparison 包含 available、summary、changes。没有 previousAnalysisSnapshot 时 available=false、changes=[]。有历史快照时只比较输入可证实的变化。",
        "changes 每项包含 field、previous、current、significance、basis；significance 只能是 high、medium、low。",
        "所有 sourceIds 必须来自输入 publicSources；所有自然语言字段使用简体中文。"
      ].join("\n")
    },
    { role: "user", content: buildInvestmentInput(input) }
  ];
}

function buildInvestmentInput(input) {
  const payload = {
    companyName: text(input.companyName, 300),
    companyProfile: compactObject(input.analysis?.companyProfile, 300),
    claims: array(input.analysis?.claims).slice(0, 30).map((item) => compactObject(item, 500)),
    businessAudit: {
      summary: input.businessAudit?.summary,
      metrics: array(input.businessAudit?.metrics).slice(0, 40).map((item) => compactObject(item, 350)),
      checks: array(input.businessAudit?.checks).slice(0, 24).map((item) => compactObject(item, 400)),
      assumptions: array(input.businessAudit?.assumptions).slice(0, 24).map((item) => compactObject(item, 400))
    },
    claimLedger: {
      summary: input.claimLedger?.summary,
      claims: array(input.claimLedger?.claims).slice(0, 30).map((item) => ({
        id: text(item?.id, 100),
        statement: text(item?.statement, 500),
        status: item?.status,
        confidence: item?.confidence,
        sourceIds: unique([
          ...array(item?.supportingSources).map((source) => source?.id),
          ...array(item?.conflictingSources).map((source) => source?.id),
          ...array(item?.candidateSources).map((source) => source?.id)
        ])
      }))
    },
    publicSources: array(input.sources).slice(0, 24).map((item) => ({
      id: text(item?.id, 100),
      title: text(item?.title, 300),
      snippet: text(item?.snippet, 700),
      supports: array(item?.supports).slice(0, 20),
      conflicts: array(item?.conflicts).slice(0, 20),
      sourceTier: item?.sourceTier
    })),
    previousAnalysisSnapshot: compactSnapshot(input.previousAnalysisSnapshot)
  };
  return JSON.stringify(payload);
}

function compactSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    completedAt: snapshot.completedAt,
    filename: text(snapshot.filename, 300),
    companyProfile: compactObject(snapshot.analysis?.companyProfile, 300),
    claims: array(snapshot.analysis?.claims).slice(0, 30).map((item) => compactObject(item, 400)),
    businessAudit: {
      metrics: array(snapshot.businessAudit?.metrics).slice(0, 30).map((item) => compactObject(item, 300)),
      assumptions: array(snapshot.businessAudit?.assumptions).slice(0, 20).map((item) => compactObject(item, 300))
    },
    decision: compactObject(snapshot.investmentAnalysis?.decision, 400),
    marketSizing: compactObject(snapshot.investmentAnalysis?.marketSizing, 400)
  };
}

function normalizeMarketSizing(value = {}) {
  return {
    status: MARKET_STATUSES.has(value?.status) ? value.status : "not_calculable",
    method: text(value?.method, 1000),
    formula: text(value?.formula, 1000),
    inputs: array(value?.inputs).slice(0, 30).map((item) => ({
      name: text(item?.name, 200), value: text(item?.value, 200), unit: text(item?.unit, 100),
      origin: text(item?.origin, 100), sourceIds: ids(item?.sourceIds)
    })),
    scenarios: array(value?.scenarios).slice(0, 8).map((item) => ({
      name: text(item?.name, 150), result: text(item?.result, 300), formula: text(item?.formula, 500),
      assumptions: array(item?.assumptions).slice(0, 12).map((entry) => text(entry, 300)), sourceIds: ids(item?.sourceIds)
    })),
    gaps: array(value?.gaps).slice(0, 20).map((item) => text(item, 400)),
    sourceIds: ids(value?.sourceIds)
  };
}

function normalizeCompetitorMatrix(value = {}) {
  return {
    dimensions: array(value?.dimensions).slice(0, 12).map((item) => text(item, 150)),
    rows: array(value?.rows).slice(0, 20).map((item) => ({
      name: text(item?.name, 200), relationship: text(item?.relationship, 300),
      values: compactObject(item?.values, 300), sourceIds: ids(item?.sourceIds),
      confidence: CONFIDENCE_LEVELS.has(item?.confidence) ? item.confidence : "low"
    })).filter((item) => item.name),
    gaps: array(value?.gaps).slice(0, 20).map((item) => text(item, 400))
  };
}

function normalizeDecision(value = {}) {
  return {
    stance: DECISION_LEVELS.has(value?.stance) ? value.stance : "insufficient",
    thesis: stringList(value?.thesis, 20),
    antiThesis: stringList(value?.antiThesis, 20),
    keyAssumptions: stringList(value?.keyAssumptions, 20),
    vetoItems: array(value?.vetoItems).slice(0, 20).map((item) => ({
      condition: text(item?.condition, 400), basis: text(item?.basis, 500),
      verification: text(item?.verification, 400), sourceIds: ids(item?.sourceIds)
    })).filter((item) => item.condition),
    milestones: stringList(value?.milestones, 20),
    nextSteps: stringList(value?.nextSteps, 20)
  };
}

function normalizeVersionComparison(value = {}) {
  const available = value?.available === true;
  return {
    available,
    summary: text(value?.summary, 1000) || (available ? "已形成版本比较" : "首次核查，无历史 BP 可比"),
    changes: available ? array(value?.changes).slice(0, 30).map((item) => ({
      field: text(item?.field, 250), previous: text(item?.previous, 500), current: text(item?.current, 500),
      significance: ["high", "medium", "low"].includes(item?.significance) ? item.significance : "medium",
      basis: text(item?.basis, 500)
    })).filter((item) => item.field) : []
  };
}

function compactObject(value, maxLength) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [key, Array.isArray(item)
    ? item.slice(0, 20).map((entry) => typeof entry === "object" ? compactObject(entry, maxLength) : text(entry, maxLength))
    : typeof item === "object" ? compactObject(item, maxLength) : text(item, maxLength)]));
}

function stringList(value, limit) {
  return array(value).slice(0, limit).map((item) => text(item, 500)).filter(Boolean);
}

function ids(value) {
  return unique(array(value).map((item) => text(item, 100))).slice(0, 30);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function text(value, maxLength) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
