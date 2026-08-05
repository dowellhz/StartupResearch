import test from "node:test";
import assert from "node:assert/strict";
import { buildExtractionMessages, buildFollowupMessages, buildReportMessages } from "../src/domain/review-prompts.js";

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
  const investmentAnalysis = {
    marketSizing: {
      status: "partial",
      inputs: Array.from({ length: 40 }, () => ({ name: "参数".repeat(200), value: "100".repeat(200), origin: "BP", sourceIds: ["source_1"] })),
      scenarios: Array.from({ length: 20 }, () => ({ name: "基准", result: "待验证".repeat(200), assumptions: Array.from({ length: 30 }, () => "假设".repeat(200)) }))
    },
    competitorMatrix: {
      dimensions: Array.from({ length: 20 }, (_, index) => `维度${index}`),
      rows: Array.from({ length: 30 }, () => ({ name: "竞品", relationship: "直接竞品".repeat(100), values: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`维度${index}`, "对比".repeat(200)])) }))
    },
    decision: {
      stance: "conditional",
      thesis: Array.from({ length: 30 }, () => "正面论点".repeat(200)),
      antiThesis: Array.from({ length: 30 }, () => "反面论点".repeat(200)),
      vetoItems: Array.from({ length: 30 }, () => ({ condition: "否决条件".repeat(200), verification: "核验方法".repeat(200) }))
    },
    versionComparison: { available: true, changes: Array.from({ length: 40 }, () => ({ field: "收入", previous: "1".repeat(500), current: "2".repeat(500), basis: "两版 BP".repeat(200) })) }
  };
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
    investmentAnalysis,
    sources,
    crossCheck: {}
  })[1].content;
  assert.doesNotThrow(() => JSON.parse(reportPayload));
  assert.equal(JSON.parse(reportPayload).investmentAnalysis.versionComparison.available, true);
  assert.ok(reportPayload.length < 100000);
});

test("follow-up context includes the latest public evidence refresh report", () => {
  const messages = buildFollowupMessages({
    companyName: "刷新科技",
    report: "# 原报告",
    history: [],
    question: "最近有什么变化？",
    evidenceRefresh: { report: "# 公开资料刷新报告\n\n新增客户合作证据" }
  });
  assert.match(JSON.stringify(messages), /新增客户合作证据/);
});
