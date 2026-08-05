import test from "node:test";
import assert from "node:assert/strict";
import { buildBpBusinessAudit } from "../src/domain/bp-business-audit.js";

test("business audit normalizes BP metrics and derives conflict counts", () => {
  const audit = buildBpBusinessAudit({
    metrics: [{ id: "m1", category: "financial", name: "ARR", value: 1200, unit: "万元", period: "2026", bpEvidence: "第8页" }],
    checks: [{
      id: "c1",
      type: "arithmetic",
      status: "conflict",
      severity: "high",
      description: "MRR 无法支持 BP 披露的 ARR",
      formula: "ARR = MRR × 12",
      inputs: [{ name: "MRR", value: 50, unit: "万元", bpEvidence: "第7页" }],
      result: 600,
      bpEvidence: "第7-8页",
      relatedMetricIds: ["m1"],
      nextStep: "索取月度收入明细"
    }],
    assumptions: [{ domain: "增长", statement: "客户数每年翻倍", bpEvidence: "第10页", verificationMethod: "核对历史客户增长" }]
  });
  assert.equal(audit.metrics[0].value, "1200");
  assert.equal(audit.checks[0].status, "conflict");
  assert.equal(audit.summary.metricCount, 1);
  assert.equal(audit.summary.conflictCount, 1);
  assert.equal(audit.summary.highSeverityCount, 1);
});

test("business audit keeps missing or invalid model fields recoverable", () => {
  const audit = buildBpBusinessAudit({ metrics: [{ name: "流失客户数", value: 0 }], checks: [{ description: "口径不明", status: "unsupported-status" }] });
  assert.equal(audit.checks[0].status, "uncertain");
  assert.equal(audit.checks[0].severity, "medium");
  assert.equal(audit.metrics[0].value, "0");
  assert.equal(audit.summary.metricCount, 1);
});
