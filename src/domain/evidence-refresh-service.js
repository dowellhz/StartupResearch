import { randomUUID } from "node:crypto";
import { buildClaimLedger } from "./claim-ledger.js";
import { transitionEvidenceRefresh } from "./evidence-refresh-state-machine.js";
import { Result } from "./result.js";
import { buildEvidenceAssessment, normalizeEvidenceSources } from "./research-evidence-service.js";
import { completeStructuredJson } from "./structured-model-call.js";

const MAX_QUERIES = 8;
const MAX_HISTORY = 10;
const CHANGE_TYPES = new Set(["actual_change", "new_evidence", "conflict", "unknown"]);
const SEVERITIES = new Set(["high", "medium", "low"]);

export function createEvidenceRefreshService({ model, repository, now = () => new Date().toISOString() }) {
  if (!model?.webSearch || !model?.complete) throw new Error("evidence refresh requires search and structured model dependencies");
  const steps = [
    { key: "refresh-plan", label: "制定刷新计划", run: planRefresh },
    { key: "refresh-search", label: "刷新公开资料", run: searchEvidence },
    { key: "refresh-assess", label: "识别证据与事实变化", run: assessChanges },
    { key: "refresh-persist", label: "保存变化报告", run: persistRefresh }
  ];

  function createRefresh() {
    return {
      id: `refresh_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      status: "queued",
      queryBudget: MAX_QUERIES,
      steps: steps.map(({ key, label }) => ({ key, label, status: "pending", message: "" })),
      checkpoints: {},
      startedAt: now(),
      completedAt: "",
      error: "",
      failedStep: ""
    };
  }

  async function execute(job, { onEvent = () => {}, signal } = {}) {
    let context = { job: await saveRefresh(job, transitionEvidenceRefresh(job.evidenceRefresh, "running")), onEvent, signal };
    for (const step of steps) {
      if (signal?.aborted) return Result.fail("资料刷新已终止", { failedStep: step.key, context });
      if (context.job.evidenceRefresh?.checkpoints?.[step.key]?.completed) {
        context = restoreCheckpoint(context, step.key);
        emit(context, step, "restored", "已从刷新 checkpoint 恢复");
        continue;
      }
      emit(context, step, "running", runningMessage(step.key));
      try {
        context = await step.run(context);
        emit(context, step, "completed", completedMessage(step.key, context));
        context = await checkpoint(context, step.key);
      } catch (error) {
        if (signal?.aborted) return Result.fail(error, { failedStep: step.key, context });
        const refresh = transitionEvidenceRefresh(context.job.evidenceRefresh, "failed", { error: error.message || String(error), failedStep: step.key });
        context.job = { ...context.job, evidenceRefresh: refresh };
        emit(context, step, "failed", refresh.error);
        context.job = await saveRefresh(context.job, context.job.evidenceRefresh);
        return Result.fail(error, { failedStep: step.key, context });
      }
    }
    onEvent({ type: "refresh_complete", data: { refresh: publicRefresh(context.job.evidenceRefresh), result: context.job.lastEvidenceRefresh }, at: now() });
    return Result.ok(context);
  }

  async function planRefresh(context) {
    const companyName = String(context.job.companyName || "").trim();
    const priorQueries = array(context.job.researchPlan?.searchQueries);
    const packQueries = array(context.job.researchPlan?.verificationPacks).map((pack) => pack?.query);
    const latestQuery = companyName ? `${companyName} 最新 融资 团队 客户 产品 监管 诉讼` : "";
    const queries = unique([latestQuery, ...packQueries, ...priorQueries]).slice(0, MAX_QUERIES);
    if (!queries.length) throw new Error("当前任务没有可执行的公开资料刷新查询");
    return {
      ...context,
      refreshPlan: {
        queries,
        requestedTools: array(context.job.researchPlan?.requestedTools).slice(0, 3),
        claimCount: array(currentAnalysis(context.job)?.claims).length,
        baselineSourceCount: array(context.job.sources).length
      }
    };
  }

  async function searchEvidence(context) {
    const analysis = currentAnalysis(context.job);
    let searchedSources = [];
    let searchWarning = "";
    try {
      const rawSources = await model.webSearch({
        companyName: context.job.companyName,
        queries: context.refreshPlan.queries,
        claims: array(analysis?.claims).filter((claim) => ["critical", "high"].includes(claim?.importance)).slice(0, 16),
        requestedTools: context.refreshPlan.requestedTools,
        signal: context.signal,
        onToolCall: (tool) => context.onEvent({
          type: "refresh_tool",
          data: { refreshId: context.job.evidenceRefresh.id, label: tool.label },
          at: now()
        })
      });
      searchedSources = normalizeEvidenceSources(rawSources).map((source) => ({ ...source, retrievedAt: now() }));
      if (!searchedSources.length) searchWarning = "本次刷新未形成新的可引用来源，旧证据已完整保留";
    } catch (error) {
      searchWarning = `公开资料刷新降级：${error.message || error}。旧证据已完整保留。`;
    }
    return { ...context, searchedSources, searchWarning };
  }

  async function assessChanges(context) {
    const baselineSources = normalizeEvidenceSources(context.job.sources || []);
    const sourceDelta = compareSources(baselineSources, context.searchedSources);
    const mergedAssessment = buildEvidenceAssessment({
      claims: array(currentAnalysis(context.job)?.claims),
      sources: [...context.searchedSources, ...baselineSources]
    });
    const claimLedger = buildClaimLedger({
      claims: array(currentAnalysis(context.job)?.claims),
      sources: mergedAssessment.sources,
      coverage: mergedAssessment.coverage
    });
    const claimChanges = compareClaimStatuses(context.job.claimLedger, claimLedger);
    const semantic = await analyzeMaterialChanges({
      companyName: context.job.companyName,
      baselineSources,
      searchedSources: context.searchedSources,
      sourceDelta,
      claimChanges,
      signal: context.signal
    });
    const result = {
      id: context.job.evidenceRefresh.id,
      status: context.searchWarning || semantic.warning ? "needs_attention" : "completed",
      startedAt: context.job.evidenceRefresh.startedAt,
      completedAt: now(),
      summary: semantic.value.summary,
      counts: {
        queryCount: context.refreshPlan.queries.length,
        baselineSourceCount: baselineSources.length,
        searchedSourceCount: context.searchedSources.length,
        addedSourceCount: sourceDelta.addedSources.length,
        refreshedSourceCount: sourceDelta.refreshedSources.length,
        claimChangeCount: claimChanges.length,
        materialChangeCount: semantic.value.materialChanges.length
      },
      materialChanges: semantic.value.materialChanges,
      watchItems: semantic.value.watchItems,
      claimChanges,
      addedSources: sourceDelta.addedSources,
      refreshedSources: sourceDelta.refreshedSources,
      warning: joinWarnings(context.searchWarning, semantic.warning)
    };
    result.report = buildRefreshReport(result);
    return {
      ...context,
      refreshResult: result,
      mergedSources: mergedAssessment.sources,
      claimLedger,
      crossCheck: { coverage: mergedAssessment.coverage, ...mergedAssessment.metrics }
    };
  }

  async function analyzeMaterialChanges({ companyName, baselineSources, searchedSources, sourceDelta, claimChanges, signal }) {
    if (!searchedSources.length) return {
      value: { summary: "本次刷新未形成新的可引用来源，无法判断公开事实是否发生变化。", materialChanges: [], watchItems: [] },
      warning: ""
    };
    const changeCandidates = [...sourceDelta.addedSources, ...sourceDelta.refreshedSources];
    if (!changeCandidates.length && !claimChanges.length) return {
      value: { summary: "本次重新检索到的来源与已有证据库一致，未形成可证实的新增变化。", materialChanges: [], watchItems: [] },
      warning: ""
    };
    try {
      const value = await completeStructuredJson({
        model,
        signal,
        maxTokens: 3000,
        messages: buildChangeMessages({ companyName, baselineSources, searchedSources, sourceDelta, claimChanges }),
        validate: (raw) => normalizeChangeAnalysis(raw, changeCandidates)
      });
      return { value, warning: "" };
    } catch (error) {
      if (signal?.aborted) throw error;
      return {
        value: { summary: "已完成确定性来源差异核对，但语义变化分析未稳定输出。", materialChanges: [], watchItems: [] },
        warning: `语义变化分析降级：${error.message || error}`
      };
    }
  }

  async function persistRefresh(context) {
    const historyItem = {
      id: context.refreshResult.id,
      status: context.refreshResult.status,
      completedAt: context.refreshResult.completedAt,
      summary: context.refreshResult.summary,
      counts: context.refreshResult.counts
    };
    const refresh = transitionEvidenceRefresh(context.job.evidenceRefresh, context.refreshResult.status, {
      completedAt: context.refreshResult.completedAt,
      error: "",
      failedStep: ""
    });
    const job = await repository.save({
      ...context.job,
      sources: context.mergedSources,
      claimLedger: context.claimLedger,
      crossCheck: context.crossCheck,
      lastEvidenceRefresh: context.refreshResult,
      evidenceRefreshHistory: [...array(context.job.evidenceRefreshHistory), historyItem].slice(-MAX_HISTORY),
      evidenceRefresh: refresh
    });
    return { ...context, job };
  }

  async function checkpoint(context, stepKey) {
    const artifacts = {
      "refresh-plan": { refreshPlan: context.refreshPlan },
      "refresh-search": { searchedSources: context.searchedSources, searchWarning: context.searchWarning },
      "refresh-assess": {
        refreshResult: context.refreshResult,
        mergedSources: context.mergedSources,
        claimLedger: context.claimLedger,
        crossCheck: context.crossCheck
      },
      "refresh-persist": {}
    };
    const refresh = {
      ...context.job.evidenceRefresh,
      checkpoints: {
        ...(context.job.evidenceRefresh.checkpoints || {}),
        [stepKey]: { completed: true, at: now(), artifact: artifacts[stepKey] || {} }
      }
    };
    return { ...context, job: await saveRefresh(context.job, refresh) };
  }

  async function saveRefresh(job, refresh) {
    return repository.save({ ...job, evidenceRefresh: refresh });
  }

  function emit(context, step, status, message) {
    const refresh = context.job.evidenceRefresh;
    refresh.steps = refresh.steps.map((item) => item.key === step.key ? { ...item, status, message, updatedAt: now() } : item);
    context.onEvent({ type: "refresh_stage", data: { refresh: publicRefresh(refresh) }, at: now() });
  }

  return { createRefresh, execute, steps: steps.map(({ key, label }) => ({ key, label })) };
}

export function publicRefresh(refresh) {
  if (!refresh) return null;
  return {
    id: refresh.id,
    status: refresh.status,
    queryBudget: refresh.queryBudget,
    steps: array(refresh.steps),
    checkpointCount: Object.keys(refresh.checkpoints || {}).length,
    startedAt: refresh.startedAt,
    completedAt: refresh.completedAt,
    error: refresh.error,
    failedStep: refresh.failedStep
  };
}

function compareSources(baselineSources, searchedSources) {
  const baseline = new Map(baselineSources.map((source) => [source.url, source]));
  const addedSources = searchedSources.filter((source) => !baseline.has(source.url));
  const refreshedSources = searchedSources.filter((source) => {
    const previous = baseline.get(source.url);
    return previous && normalizeText(previous.snippet) !== normalizeText(source.snippet);
  });
  return { addedSources, refreshedSources };
}

function compareClaimStatuses(previousLedger, nextLedger) {
  const previous = new Map(array(previousLedger?.claims).map((claim) => [claim.id, claim]));
  return array(nextLedger?.claims).flatMap((claim) => {
    const prior = previous.get(claim.id);
    if (!prior || prior.status === claim.status) return [];
    return [{ claimId: claim.id, statement: claim.statement, previousStatus: prior.status, currentStatus: claim.status, confidence: claim.confidence }];
  }).slice(0, 30);
}

function buildChangeMessages({ companyName, baselineSources, searchedSources, sourceDelta, claimChanges }) {
  return [{
    role: "system",
    content: [
      "你是投资项目公开信息变化分析师，只输出合法 JSON。",
      "区分：真实事实变化、这次新找到的旧证据、证据冲突、无法判断。搜索结果新增不等于现实刚发生变化。",
      "不得因为本次搜索没返回某来源就断言事实消失；不得发明日期、事件或来源。",
      "输出 {summary,materialChanges,watchItems}。materialChanges 每项包含 changeType、category、title、description、impact、severity、sourceIds。",
      "changeType 只能是 actual_change、new_evidence、conflict、unknown；severity 只能是 high、medium、low。",
      "sourceIds 只能引用 currentSources 中的 id。watchItems 为后续应继续观察的简体中文字符串。"
    ].join("\n")
  }, {
    role: "user",
    content: JSON.stringify({
      companyName,
      baselineSources: baselineSources.slice(0, 24).map(compactSource),
      currentSources: searchedSources.slice(0, 24).map(compactSource),
      addedSourceIds: sourceDelta.addedSources.map((source) => source.id),
      refreshedSourceIds: sourceDelta.refreshedSources.map((source) => source.id),
      claimChanges
    })
  }];
}

function normalizeChangeAnalysis(raw = {}, searchedSources) {
  raw ||= {};
  const allowed = new Set(searchedSources.map((source) => source.id));
  const materialChanges = array(raw.materialChanges).slice(0, 20).map((item) => ({
    changeType: CHANGE_TYPES.has(item?.changeType) ? item.changeType : "unknown",
    category: text(item?.category, 120),
    title: text(item?.title, 250),
    description: text(item?.description, 600),
    impact: text(item?.impact, 500),
    severity: SEVERITIES.has(item?.severity) ? item.severity : "medium",
    sourceIds: unique(array(item?.sourceIds).map((id) => String(id || "")).filter((id) => allowed.has(id))).slice(0, 12)
  })).filter((item) => item.title && item.sourceIds.length);
  return {
    summary: materialChanges.length ? text(raw.summary, 1000) || "本次刷新形成了可引用的公开证据变化。" : "本次刷新未识别到可证实的重大公开事实变化。",
    materialChanges,
    watchItems: array(raw.watchItems).slice(0, 16).map((item) => text(item, 400)).filter(Boolean)
  };
}

function buildRefreshReport(result) {
  const sourceById = new Map([...result.addedSources, ...result.refreshedSources].map((source) => [source.id, source]));
  const changes = result.materialChanges.length
    ? result.materialChanges.map((item) => {
      const citations = item.sourceIds.map((id) => sourceById.get(id)).filter(Boolean).map(sourceLink).join("、");
      return `- **${item.title}**（${changeTypeLabel(item.changeType)} / ${item.severity}）：${item.description}${item.impact ? `；投资影响：${item.impact}` : ""}${citations ? `；来源：${citations}` : ""}`;
    }).join("\n")
    : "本次刷新未识别到有充分证据支持的重大公开事实变化；这不代表现实中没有变化。";
  const claimRows = result.claimChanges.length
    ? ["| 声明 | 原状态 | 当前状态 | 置信度 |", "|---|---|---|---|", ...result.claimChanges.map((item) => `| ${cell(item.statement)} | ${cell(item.previousStatus)} | ${cell(item.currentStatus)} | ${cell(item.confidence)} |`)].join("\n")
    : "关键声明的证据状态本次没有发生变化。";
  const sources = result.addedSources.length
    ? result.addedSources.map((source) => `- ${sourceLink(source)}：${source.snippet || "未提供证据摘要"}`).join("\n")
    : "本次没有发现此前证据库中未收录的新 URL。";
  const watchItems = result.watchItems.length ? result.watchItems.map((item) => `- ${item}`).join("\n") : "- 继续按现有高优先级声明进行人工核验。";
  return [
    `# 公开资料刷新报告`,
    `> 刷新 ID：${result.id} · 完成时间：${result.completedAt}`,
    `## 刷新摘要\n\n${result.summary}${result.warning ? `\n\n> 提示：${result.warning}` : ""}`,
    `## 重大变化与新增证据\n\n${changes}`,
    `## 声明状态变化\n\n${claimRows}`,
    `## 新增公开来源\n\n${sources}`,
    `## 后续观察项\n\n${watchItems}`
  ].join("\n\n");
}

function compactSource(source) {
  return {
    id: source.id,
    title: text(source.title, 250),
    url: text(source.url, 1500),
    snippet: text(source.snippet, 700),
    publishedAt: source.publishedAt,
    sourceTier: source.sourceTier,
    provider: text(source.provider, 100)
  };
}

function sourceLink(source) {
  return `[${String(source.title || source.url).replace(/[\[\]]/g, "").slice(0, 300)}](${source.url})`;
}

function changeTypeLabel(value) {
  return { actual_change: "事实变化", new_evidence: "新增证据", conflict: "证据冲突", unknown: "待确认" }[value] || "待确认";
}

function currentAnalysis(job) {
  return job.analysis || job.checkpoints?.["claim-extraction"]?.artifact?.analysis || {};
}

function restoreCheckpoint(context, stepKey) {
  return { ...context, ...(context.job.evidenceRefresh.checkpoints[stepKey].artifact || {}) };
}

function runningMessage(key) {
  return {
    "refresh-plan": "正在复用原核查计划并生成有预算的刷新查询…",
    "refresh-search": "正在重新检索公司、团队、客户、竞争及监管公开资料…",
    "refresh-assess": "正在区分事实变化、新增旧证据、冲突与无法判断…",
    "refresh-persist": "正在保存证据增量和变化报告…"
  }[key];
}

function completedMessage(key, context) {
  if (key === "refresh-plan") return `已生成 ${context.refreshPlan.queries.length}/${MAX_QUERIES} 个刷新查询`;
  if (key === "refresh-search") return context.searchWarning || `已重新获取 ${context.searchedSources.length} 个公开来源`;
  if (key === "refresh-assess") return `发现 ${context.refreshResult.counts.addedSourceCount} 个新来源、${context.refreshResult.counts.materialChangeCount} 项材料变化`;
  if (key === "refresh-persist") return "变化报告和证据增量已保存";
  return "已完成";
}

function joinWarnings(...values) {
  return values.map((value) => String(value || "").trim()).filter(Boolean).join("；");
}

function cell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 500);
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function text(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
