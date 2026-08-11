import test from "node:test";
import assert from "node:assert/strict";
import { createInvestmentAnalysisService } from "../src/domain/investment-analysis-service.js";
import { buildFallbackReport } from "../src/domain/report-fallback.js";

test("investment analysis normalizes decision artifacts and rejects invented source ids", async () => {
  const model = {
    complete: async () => JSON.stringify({
      marketSizing: {
        status: "reconstructed",
        method: "客户数乘以客单价",
        formula: "客户数 × 客单价",
        inputs: [{ name: "客户数", value: "100", origin: "BP", sourceIds: ["source_1", "invented"] }],
        scenarios: [{ name: "基准", result: "1000万元", sourceIds: ["source_1"] }],
        sourceIds: ["invented"]
      },
      competitorMatrix: { dimensions: ["产品"], rows: [{ name: "竞品甲", values: { 产品: "相近" }, sourceIds: ["source_1"], confidence: "high" }] },
      decision: { stance: "conditional", thesis: ["市场存在需求"], vetoItems: [{ condition: "客户无法复核", sourceIds: ["invented"] }] },
      versionComparison: { available: true, summary: "虚构的版本比较", changes: [{ field: "收入", previous: "1", current: "2" }] }
    })
  };
  const service = createInvestmentAnalysisService({ model });
  const result = await service.analyze({ sources: [{ id: "source_1" }] });
  assert.equal(result.warning, "");
  assert.equal(result.value.marketSizing.status, "reconstructed");
  assert.deepEqual(result.value.marketSizing.inputs[0].sourceIds, ["source_1"]);
  assert.deepEqual(result.value.marketSizing.sourceIds, []);
  assert.equal(result.value.decision.stance, "conditional");
  assert.equal(result.value.versionComparison.available, false);
  assert.deepEqual(result.value.versionComparison.changes, []);
});

test("investment analysis keeps comparable-company evidence inside its source budget", async () => {
  let payload;
  const service = createInvestmentAnalysisService({ model: {
    complete: async (messages) => {
      payload = JSON.parse(messages[1].content);
      return JSON.stringify({ marketSizing: {}, competitorMatrix: {}, decision: {}, versionComparison: {} });
    }
  } });
  const sources = Array.from({ length: 45 }, (_, index) => ({ id: `source_${index + 1}`, title: `来源 ${index + 1}` }));
  await service.analyze({
    sources,
    comparableCompanyResearch: { invoked: true, synthesis: { internationalPeers: [{ name: "海外竞品", sourceIds: ["source_45"] }] } }
  });
  assert.equal(payload.publicSources[0].id, "source_45");
});

test("investment analysis preserves a recoverable empty artifact after its retry budget", async () => {
  let calls = 0;
  const service = createInvestmentAnalysisService({ model: { complete: async () => { calls += 1; return "not-json"; } } });
  const result = await service.analyze({ previousAnalysisSnapshot: { completedAt: "2026-08-01" } });
  assert.equal(calls, 2);
  assert.match(result.warning, /连续两次异常/);
  assert.equal(result.value.marketSizing.status, "not_calculable");
  assert.equal(result.value.versionComparison.available, true);
});

test("investment analysis keeps evidence-based changes when a prior BP snapshot exists", async () => {
  const service = createInvestmentAnalysisService({
    model: { complete: async () => JSON.stringify({
      marketSizing: {}, competitorMatrix: {}, decision: {},
      versionComparison: { available: true, summary: "收入目标上调", changes: [{ field: "收入目标", previous: "1000万", current: "1500万", significance: "high", basis: "两版 BP" }] }
    }) }
  });
  const result = await service.analyze({ previousAnalysisSnapshot: { analysis: { claims: [] } } });
  assert.equal(result.value.versionComparison.available, true);
  assert.equal(result.value.versionComparison.changes[0].field, "收入目标");
});

test("fallback reports retain market, competitor, decision and version artifacts", () => {
  const report = buildFallbackReport({
    companyName: "版本科技",
    investmentAnalysis: {
      marketSizing: { status: "partial", method: "自下而上", scenarios: [{ name: "基准", result: "1000万元" }] },
      competitorMatrix: { dimensions: ["产品"], rows: [{ name: "竞品甲", relationship: "直接竞品", values: { 产品: "相近" } }] },
      decision: { stance: "conditional", vetoItems: [{ condition: "客户无法复核", verification: "客户访谈" }], milestones: ["完成十家客户复核"] },
      versionComparison: { available: true, changes: [{ field: "收入目标", previous: "1000万", current: "1500万", significance: "high", basis: "两版 BP" }] }
    }
  });
  assert.match(report, /自下而上/);
  assert.match(report, /竞品甲/);
  assert.match(report, /客户无法复核/);
  assert.match(report, /收入目标/);
});

test("fallback reports render structured BP citations instead of object placeholders", () => {
  const report = buildFallbackReport({
    companyName: "证据科技",
    analysis: {
      claims: [{ domain: "客户", statement: "已完成客户交付", bpEvidence: { pageNumber: 6, exactQuote: "已完成三家客户交付" } }]
    }
  });
  assert.match(report, /第 6 页：“已完成三家客户交付”/);
  assert.doesNotMatch(report, /\[object Object\]/);
});
