import test from "node:test";
import assert from "node:assert/strict";
import { createComparableCompanyResearchToolService } from "../src/domain/comparable-company-research-tool-service.js";

test("comparable company research plans separate domestic and international searches", async () => {
  const calls = [];
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
      domesticPeers: [{ name: "国内甲", relationship: "direct", product: "神经监测设备", sourceIds: ["source_1"], confidence: "high" }],
      internationalPeers: [{ name: "海外乙", relationship: "adjacent", product: "无创刺激设备", sourceIds: ["source_2"], confidence: "medium" }],
      alternatives: [{ name: "无来源候选", relationship: "substitute", sourceIds: [], confidence: "low" }],
      subjectPositioning: ["目标公司尝试整合监测与刺激"],
      gaps: ["缺少同口径临床性能数据"]
    }
  ];
  const model = {
    complete: async () => JSON.stringify(responses.shift()),
    webSearch: async (input) => {
      calls.push(input);
      return [
        { title: "国内甲官网", url: "https://cn.example.com", snippet: "国内甲提供神经监测设备" },
        { title: "海外乙官网", url: "https://global.example.com", snippet: "海外乙提供无创刺激设备" }
      ];
    }
  };
  const tool = createComparableCompanyResearchToolService({ model, now: () => "2026-08-11T00:00:00.000Z" });
  const value = await tool.research({ companyName: "目标公司", analysis: { companyProfile: { sector: "神经科技" } } });
  assert.equal(value.invoked, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].queries.length, 4);
  assert.ok(calls[0].requestedTools.includes("general_web_search"));
  assert.equal(value.synthesis.domesticPeers[0].name, "国内甲");
  assert.equal(value.synthesis.internationalPeers[0].name, "海外乙");
  assert.equal(value.synthesis.alternatives.length, 0, "peers without evidence must be removed");
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
