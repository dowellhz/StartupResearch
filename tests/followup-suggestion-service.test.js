import test from "node:test";
import assert from "node:assert/strict";
import { buildFollowupSuggestions, normalizeFollowupSuggestions } from "../src/domain/followup-suggestion-service.js";

test("follow-up suggestions reflect the BP risk categories", () => {
  const suggestions = buildFollowupSuggestions({
    analysis: {
      risks: [
        { category: "技术壁垒", description: "缺少第三方性能验证" },
        { category: "客户与收入", description: "订单证据待核实" }
      ],
      missingInformation: ["客户合同"]
    }
  });
  assert.equal(suggestions.length, 4);
  assert.ok(suggestions.some((question) => question.startsWith("核心技术｜")));
  assert.ok(suggestions.some((question) => question.startsWith("技术验证｜")));
  assert.ok(suggestions.some((question) => question.startsWith("行业研究｜")));
  assert.ok(suggestions.some((question) => question.startsWith("商业化｜")));
});

test("follow-up suggestions are unique, bounded and safe to expose", () => {
  assert.deepEqual(normalizeFollowupSuggestions(["  问题内容足够长？ ", "问题内容足够长？", "短", null]), ["问题内容足够长？"]);
  assert.deepEqual(buildFollowupSuggestions({}).map((question) => question.split("｜")[0]), ["核心能力", "商业验证", "行业研究", "尽调建议"]);
});

test("clinical BP suggestions organize pipeline, evidence, industry and commercialization questions", () => {
  const suggestions = buildFollowupSuggestions({ analysis: { companyProfile: { sector: "创新药" }, claims: [{ domain: "临床试验", statement: "推进适应症管线" }] } });
  assert.equal(suggestions.length, 4);
  assert.match(suggestions[1], /临床试验与监管申报/);
  assert.match(suggestions[2], /竞争管线/);
});

test("a generic data pipeline does not trigger medical follow-up questions", () => {
  const suggestions = buildFollowupSuggestions({ analysis: { companyProfile: { sector: "AI数据基础设施" }, claims: [{ domain: "技术", statement: "专家层作用于整条数据管线" }] } });
  assert.match(suggestions[0], /^核心技术｜/);
  assert.doesNotMatch(suggestions.join(" "), /临床|适应症|药物/);
});
