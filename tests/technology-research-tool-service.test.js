import test from "node:test";
import assert from "node:assert/strict";
import { createTechnologyResearchToolService } from "../src/domain/technology-research-tool-service.js";

test("technology research tool is invoked only after a structured relevance decision", async () => {
  const searches = [];
  let completions = 0;
  const model = {
    complete: async () => {
      completions += 1;
      if (completions === 1) return JSON.stringify({
        needed: true,
        topic: "fNIRS + EEG + temporal interference 闭环神经调控",
        reason: "刺激、采集与反馈链路决定产品可行性和安全性",
        questions: ["三类技术如何同步？", "TI 伪迹如何抑制？", "闭环指标如何验证？"],
        queries: ["fNIRS EEG temporal interference simultaneous recording", "temporal interference stimulation EEG artifact", "fNIRS EEG closed loop validation"]
      });
      return JSON.stringify({
        findings: [{ statement: "现有证据主要处于实验研究阶段", sourceIds: ["source_1"], confidence: "medium" }],
        approaches: [{ name: "同步多模态采集", principle: "共同时间基准", strengths: [], limitations: ["刺激伪迹"], sourceIds: ["source_1"] }],
        maturity: { stage: "lab_prototype", basis: "论文实验", sourceIds: ["source_1"], gaps: ["缺少临床规模验证"] },
        bottlenecks: ["刺激伪迹和跨设备时钟同步"],
        validationPlan: [{ hypothesis: "可实时抑制伪迹", method: "受控对照实验", metrics: ["SNR"], baseline: "关闭 TI", passCriteria: "SNR 达标", failureCriteria: "无法恢复 EEG" }],
        unknowns: ["长期安全性"]
      });
    },
    webSearch: async (input) => {
      searches.push(input);
      return [{ title: "Neurotechnology paper", url: "https://example.com/paper", snippet: "A controlled laboratory prototype study." }];
    }
  };
  const tool = createTechnologyResearchToolService({ model });
  const value = await tool.research({ companyName: "示例脑科技", outputLanguage: "zh", analysis: { claims: [{ domain: "技术", statement: "融合 fNIRS、EEG 和 TI" }] } });
  assert.equal(value.invoked, true);
  assert.equal(value.plan.topic.includes("fNIRS"), true);
  assert.equal(value.synthesis.maturity.stage, "lab_prototype");
  assert.equal(searches.length, 1);
  assert.ok(searches[0].requestedTools.includes("clinical_trials_search"));
  assert.ok(searches[0].requestedTools.includes("arxiv_paper_search"));
  assert.ok(searches[0].requestedTools.includes("openalex_research_search"));
});

test("technology research tool skips ordinary companies without running search", async () => {
  let searched = false;
  const tool = createTechnologyResearchToolService({ model: {
    complete: async () => JSON.stringify({ needed: false, reason: "普通渠道零售业务没有明确核心技术主题" }),
    webSearch: async () => { searched = true; return []; }
  } });
  const value = await tool.research({ companyName: "示例零售", analysis: { companyProfile: { sector: "消费零售" } } });
  assert.equal(value.invoked, false);
  assert.equal(searched, false);
});

test("technology research planning failure degrades without failing company review", async () => {
  const tool = createTechnologyResearchToolService({ model: { complete: async () => "invalid", webSearch: async () => { throw new Error("must not search"); } } });
  const value = await tool.research({ companyName: "示例公司" });
  assert.equal(value.invoked, false);
  assert.match(value.warning, /判断降级/);
});
