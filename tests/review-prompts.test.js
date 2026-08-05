import test from "node:test";
import assert from "node:assert/strict";
import { buildExtractionMessages, buildReportMessages } from "../src/domain/review-prompts.js";

test("long BP inputs remain valid JSON after field-level budgeting", () => {
  const document = { filename: "bp.pdf", pageCount: 100, originalChars: 200000, truncated: true, text: "商业计划正文".repeat(30000) };
  const claims = Array.from({ length: 100 }, (_, index) => ({
    id: `c${index}`,
    domain: "市场",
    statement: "超长市场声明".repeat(200),
    bpEvidence: "第10页证据".repeat(200),
    importance: "high",
    verificationNeed: "核查公开数据".repeat(100)
  }));
  const checks = Array.from({ length: 40 }, (_, index) => ({
    id: `check_${index}`,
    status: "uncertain",
    severity: "medium",
    description: "口径需要核实".repeat(200),
    inputs: Array.from({ length: 20 }, () => ({ name: "输入", value: "100", bpEvidence: "第8页".repeat(100) }))
  }));
  const sources = Array.from({ length: 40 }, (_, index) => ({ id: `source_${index}`, title: "来源", url: `https://example.com/${index}`, snippet: "公开证据".repeat(500) }));
  const extractionPayload = buildExtractionMessages({ companyName: "示例", instruction: "全面核查", document })[1].content;
  assert.doesNotThrow(() => JSON.parse(extractionPayload));
  const reportPayload = buildReportMessages({
    companyName: "示例",
    instruction: "全面核查",
    document,
    analysis: { companyProfile: {}, claims, risks: [], missingInformation: [] },
    businessAudit: { summary: {}, metrics: [], checks, assumptions: [] },
    claimLedger: { summary: {}, claims: claims.map((claim) => ({ ...claim, status: "bp_only", supportingSources: [], conflictingSources: [], candidateSources: [] })) },
    researchPlan: { domains: ["市场"], claimPlans: [], coverageTargets: [] },
    sources,
    crossCheck: {}
  })[1].content;
  assert.doesNotThrow(() => JSON.parse(reportPayload));
  assert.ok(reportPayload.length < 100000);
});
