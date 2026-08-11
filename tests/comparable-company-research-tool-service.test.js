import test from "node:test";
import assert from "node:assert/strict";
import { createComparableCompanyResearchToolService } from "../src/domain/comparable-company-research-tool-service.js";

test("comparable company research plans separate domestic and international searches", async () => {
  const calls = [];
  let synthesisPayload;
  const responses = [
    {
      needed: true,
      scope: "面向医院的多模态神经监测与无创刺激系统",
      reason: "需要比较相同客户和临床场景下的产品",
      dimensions: ["产品形态", "临床场景", "技术路线", "商业化阶段"],
      domesticQueries: ["中国 多模态 神经监测 无创刺激 公司", "脑电 近红外 医疗器械 企业"],
      internationalQueries: ["multimodal neuro monitoring stimulation companies", "EEG fNIRS neuromodulation startup"]
    },
    {
      dimensions: ["产品形态", "临床场景"],
      domesticPeers: [{ name: "国内甲", relationship: "direct", product: "神经监测设备", sourceIds: ["source_55"], confidence: "high" }],
      internationalPeers: [{ name: "海外乙", relationship: "adjacent", product: "无创刺激设备", sourceIds: ["source_56"], confidence: "medium" }],
      alternatives: [{ name: "无来源候选", relationship: "substitute", sourceIds: [], confidence: "low" }],
      subjectPositioning: ["目标公司尝试整合监测与刺激"],
      gaps: ["缺少同口径临床性能数据"]
    }
  ];
  const model = {
    complete: async (messages) => {
      if (responses.length === 1) synthesisPayload = JSON.parse(messages[1].content);
      return JSON.stringify(responses.shift());
    },
    webSearch: async (input) => {
      calls.push(input);
      return input.companyName.includes("international")
        ? [{ title: "海外乙官网", url: "https://global.example.com", snippet: "海外乙提供无创刺激设备" }]
        : [{ title: "国内甲官网", url: "https://cn.example.com", snippet: "国内甲提供神经监测设备" }];
    }
  };
  const tool = createComparableCompanyResearchToolService({ model, now: () => "2026-08-11T00:00:00.000Z" });
  const existingSources = Array.from({ length: 54 }, (_, index) => ({ title: `原有来源 ${index + 1}`, url: `https://existing.example.com/${index + 1}`, snippet: "原有公司资料" }));
  const value = await tool.research({ companyName: "目标公司", analysis: { companyProfile: { sector: "神经科技" } }, existingSources });
  assert.equal(value.invoked, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].queries.length, 2);
  assert.equal(calls[1].queries.length, 2);
  assert.ok(calls[0].requestedTools.includes("general_web_search"));
  assert.equal(synthesisPayload.domesticSources[0].id, "source_55", "new domestic evidence must not be truncated behind existing sources");
  assert.equal(synthesisPayload.internationalSources[0].id, "source_56", "new international evidence must retain a separate quota");
  assert.equal(synthesisPayload.contextSources.length, 8);
  assert.equal(value.synthesis.domesticPeers[0].name, "国内甲");
  assert.equal(value.synthesis.internationalPeers[0].name, "海外乙");
  assert.equal(value.synthesis.alternatives.length, 0, "peers without evidence must be removed");
});

test("an empty regional result gets one focused retry and a second synthesis", async () => {
  const responses = [
    {
      needed: true, scope: "神经康复设备", reason: "需要竞品比较",
      dimensions: ["产品", "客户", "商业化"],
      domesticQueries: ["神经康复 国内 公司"], internationalQueries: ["neurorehabilitation companies"],
      domesticCandidates: ["国内甲"], internationalCandidates: ["Global B"]
    },
    {
      dimensions: ["产品"],
      domesticPeers: [{ name: "国内甲", relationship: "direct", sourceIds: ["source_1"], confidence: "high" }],
      internationalPeers: [], alternatives: [], subjectPositioning: [], gaps: ["海外证据不足"]
    },
    {
      dimensions: ["产品"],
      domesticPeers: [{ name: "国内甲", relationship: "direct", sourceIds: ["source_1"], confidence: "high" }],
      internationalPeers: [{ name: "Global B", relationship: "adjacent", sourceIds: ["source_2"], confidence: "medium" }],
      alternatives: [], subjectPositioning: [], gaps: []
    }
  ];
  let internationalCalls = 0;
  const calls = [];
  const tool = createComparableCompanyResearchToolService({ model: {
    complete: async () => JSON.stringify(responses.shift()),
    webSearch: async (input) => {
      calls.push(input);
      if (!input.companyName.includes("international")) return [{ title: "国内甲", url: "https://cn.example.com", snippet: "神经康复设备" }];
      internationalCalls += 1;
      return internationalCalls === 1
        ? [{ title: "行业概览", url: "https://global.example.com/overview", snippet: "市场概览" }]
        : [{ title: "Global B", url: "https://global.example.com/company", snippet: "Global B makes neurorehabilitation devices" }];
    }
  } });
  const value = await tool.research({ companyName: "目标公司", analysis: { companyProfile: { sector: "神经康复" } } });
  assert.equal(calls.length, 3);
  assert.match(calls[2].companyName, /international/);
  assert.equal(value.synthesis.domesticPeers[0].name, "国内甲");
  assert.equal(value.synthesis.internationalPeers[0].name, "Global B");
  assert.equal(value.warning, "");
});

test("empty domestic and international coverage remains visible after the retry budget", async () => {
  const responses = [
    {
      needed: true, scope: "新型工业传感器", reason: "需要可比公司",
      dimensions: ["产品", "客户", "技术"],
      domesticQueries: ["工业传感器 国内 公司"], internationalQueries: ["industrial sensor companies"]
    },
    { dimensions: [], domesticPeers: [], internationalPeers: [], alternatives: [], subjectPositioning: [], gaps: [] },
    { dimensions: [], domesticPeers: [], internationalPeers: [], alternatives: [], subjectPositioning: [], gaps: [] }
  ];
  let searches = 0;
  const tool = createComparableCompanyResearchToolService({ model: {
    complete: async () => JSON.stringify(responses.shift()),
    webSearch: async () => {
      searches += 1;
      return [{ title: `行业资料 ${searches}`, url: `https://example.com/${searches}`, snippet: "未形成具体企业证据" }];
    }
  } });
  const value = await tool.research({ companyName: "目标公司", analysis: { companyProfile: { sector: "工业传感器" } } });
  assert.equal(searches, 4, "each region gets one initial search and at most one retry");
  assert.match(value.warning, /国内、海外同类公司均未形成/);
});

test("comparable company research skips search when a comparable scope cannot be defined", async () => {
  let searched = false;
  const tool = createComparableCompanyResearchToolService({ model: {
    complete: async () => JSON.stringify({ needed: false, reason: "产品和客户信息不足" }),
    webSearch: async () => { searched = true; return []; }
  } });
  const value = await tool.research({ companyName: "信息不足公司", analysis: {} });
  assert.equal(value.invoked, false);
  assert.equal(searched, false);
});

test("comparable company planning failure degrades without failing the review", async () => {
  const tool = createComparableCompanyResearchToolService({ model: {
    complete: async () => "not json",
    webSearch: async () => { throw new Error("must not search"); }
  } });
  const value = await tool.research({ companyName: "示例公司", analysis: {} });
  assert.equal(value.invoked, false);
  assert.match(value.warning, /规划降级/);
});
