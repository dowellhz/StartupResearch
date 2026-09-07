// 模型调用是本系统唯一的可变成本来源，但 usage 此前被直接丢弃，
// 每日额度只能按路由拍脑袋计价（建任务 10、追问 3……）。这里把真实 token 记录下来，
// 既进审计日志，也在 /api/health 暴露当日汇总，作为后续按量计价的依据。
export function createModelUsageMeter({ logger = {}, now = () => new Date() } = {}) {
  let day = isoDay(now());
  let totals = emptyTotals();

  function record(usage, { scope = "model", model = "" } = {}) {
    const normalized = normalizeUsage(usage);
    if (!normalized) return null;
    rollOver();
    totals.calls += 1;
    totals.promptTokens += normalized.promptTokens;
    totals.completionTokens += normalized.completionTokens;
    totals.totalTokens += normalized.totalTokens;
    totals.byScope[scope] = (totals.byScope[scope] || 0) + normalized.totalTokens;
    void logger.audit?.("model.usage", { scope, model, ...normalized });
    return normalized;
  }

  function snapshot() {
    rollOver();
    return { day, ...totals, byScope: { ...totals.byScope } };
  }

  function rollOver() {
    const current = isoDay(now());
    if (current === day) return;
    day = current;
    totals = emptyTotals();
  }

  return { record, snapshot };
}

// 同时兼容 OpenAI 风格（prompt_tokens/completion_tokens）与 Anthropic 风格（input_tokens/output_tokens）。
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const promptTokens = count(usage.prompt_tokens ?? usage.input_tokens);
  const completionTokens = count(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = count(usage.total_tokens) || promptTokens + completionTokens;
  if (!totalTokens && !promptTokens && !completionTokens) return null;
  return { promptTokens, completionTokens, totalTokens };
}

function emptyTotals() {
  return { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, byScope: {} };
}

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function isoDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}
