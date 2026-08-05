const CHECK_STATUSES = new Set(["consistent", "conflict", "uncertain", "not_calculable"]);
const SEVERITIES = new Set(["high", "medium", "low"]);

export function buildBpBusinessAudit(raw = {}) {
  const metrics = array(raw.metrics).slice(0, 80).map((item, index) => normalizeMetric(item, index));
  const checks = array(raw.checks).slice(0, 40).map((item, index) => normalizeCheck(item, index));
  const assumptions = array(raw.assumptions).slice(0, 40).map((item, index) => normalizeAssumption(item, index));
  const statusCounts = countBy(checks, (item) => item.status);
  return {
    metrics,
    checks,
    assumptions,
    summary: {
      metricCount: metrics.length,
      checkCount: checks.length,
      assumptionCount: assumptions.length,
      consistentCount: statusCounts.consistent || 0,
      conflictCount: statusCounts.conflict || 0,
      uncertainCount: statusCounts.uncertain || 0,
      notCalculableCount: statusCounts.not_calculable || 0,
      highSeverityCount: checks.filter((item) => item.severity === "high").length
    }
  };
}

function normalizeMetric(item, index) {
  return {
    id: text(item?.id, 100) || `metric_${index + 1}`,
    category: text(item?.category, 100) || "other",
    name: text(item?.name, 300) || "未命名指标",
    value: scalar(item?.value, 300),
    unit: text(item?.unit, 100),
    period: text(item?.period, 200),
    bpEvidence: text(item?.bpEvidence, 1000),
    sourceClaimIds: strings(item?.sourceClaimIds, 30, 100)
  };
}

function normalizeCheck(item, index) {
  const status = CHECK_STATUSES.has(item?.status) ? item.status : "uncertain";
  const severity = SEVERITIES.has(item?.severity) ? item.severity : "medium";
  return {
    id: text(item?.id, 100) || `check_${index + 1}`,
    type: text(item?.type, 100) || "other",
    status,
    severity,
    description: text(item?.description, 1200) || "需进一步核实",
    formula: text(item?.formula, 800),
    inputs: array(item?.inputs).slice(0, 20).map(normalizeInput),
    result: scalar(item?.result, 500),
    bpEvidence: text(item?.bpEvidence, 1200),
    relatedMetricIds: strings(item?.relatedMetricIds, 30, 100),
    nextStep: text(item?.nextStep, 800)
  };
}

function normalizeInput(item) {
  if (!item || typeof item !== "object") return { name: "输入", value: scalar(item, 300), unit: "", bpEvidence: "" };
  return {
    name: text(item.name, 200) || "输入",
    value: scalar(item.value, 300),
    unit: text(item.unit, 100),
    bpEvidence: text(item.bpEvidence, 500)
  };
}

function normalizeAssumption(item, index) {
  return {
    id: text(item?.id, 100) || `assumption_${index + 1}`,
    domain: text(item?.domain, 100) || "经营",
    statement: text(item?.statement, 1000) || "未说明的经营假设",
    bpEvidence: text(item?.bpEvidence, 1000),
    verificationMethod: text(item?.verificationMethod, 800)
  };
}

function countBy(values, selector) {
  return values.reduce((counts, item) => {
    const key = selector(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function strings(value, limit, maxLength) {
  return Array.from(new Set(array(value).map((item) => text(item, maxLength)).filter(Boolean))).slice(0, limit);
}

function scalar(value, maxLength) {
  if (value === null || value === undefined) return "";
  return text(typeof value === "object" ? JSON.stringify(value) : value, maxLength);
}

function text(value, maxLength) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
