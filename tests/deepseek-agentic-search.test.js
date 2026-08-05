import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAgenticSearchQueries,
  buildGoogleScholarSearchQueries,
  createDeepSeekModelService,
  focusedSearchBatches,
  needsClinicalTrialsSearch,
  needsGoogleScholarSearch,
  normalizeSearchSources,
  planAgenticSearchToolCalls,
  uncoveredTeamSearchQueries
} from "../src/infra/deepseek-model-service.js";
import { buildSecWebFallbackQueries } from "../src/domain/research-tool-fallback.js";

test("clinical trial research adds a ClinicalTrials.gov Agentic Search query", () => {
  const queries = buildAgenticSearchQueries({
    companyName: "Example Bio",
    queries: ["Example Bio 肿瘤临床试验 Phase 2", "NCT04280705 当前状态"]
  });
  assert.match(queries[0], /^site:clinicaltrials\.gov/);
  assert.match(queries[0], /NCT04280705/);
  assert.equal(needsClinicalTrialsSearch(queries.join(" ")), true);
});

test("non-clinical research does not add a ClinicalTrials.gov query", () => {
  const queries = buildAgenticSearchQueries({ companyName: "Example SaaS", queries: ["Example SaaS ARR 客户"] });
  assert.deepEqual(queries, ["Example SaaS ARR 客户"]);
});

test("Google Scholar profile becomes a dedicated Scholar tool query", () => {
  const profile = "https://scholar.google.com/citations?user=SLyWFgYAAAAJ&hl=en";
  const queries = buildGoogleScholarSearchQueries({ companyName: "Junze CHEN", queries: [profile] });
  assert.equal(needsGoogleScholarSearch(profile), true);
  assert.match(queries[0], /^site:scholar\.google\.com\/citations/);
  assert.match(queries[0], /SLyWFgYAAAAJ/);
});

test("Agentic Search plans clinical, Crossref and OpenAlex tool calls", () => {
  const calls = planAgenticSearchToolCalls("核查 NCT04280705，并核对负责人 Google Scholar 学者主页");
  assert.deepEqual(calls.map((call) => call.name), ["clinical_trials_search", "scholarly_works_search", "openalex_research_search"]);
});

test("Agentic Search dispatches all planned academic tool calls", async () => {
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ content: [{ type: "text", text: `https://example.com/source-${requestCount}` }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  const model = createDeepSeekModelService({
    config: { apiKey: "test-key", baseUrl: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash", timeoutMs: 1000 },
    fetchImpl
  });
  const calls = [];
  const sources = await model.webSearch({
    companyName: "Example Bio",
    queries: ["核查 NCT04280705 和负责人 Google Scholar 学者主页"],
    onToolCall: (tool) => calls.push(tool.name)
  });
  assert.deepEqual(calls, ["clinical_trials_search", "scholarly_works_search", "openalex_research_search"]);
  assert.equal(requestCount, 3);
  assert.equal(sources.length, 3);
});

test("a failed structured tool is visible while successful search evidence is retained", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ content: [{
    type: "text",
    text: JSON.stringify([{ title: "Public source", url: "https://example.com/source", snippet: "usable evidence" }])
  }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  const researchTools = {
    has: () => true,
    run: async () => { throw new Error("upstream unavailable"); }
  };
  const model = createDeepSeekModelService({
    config: { apiKey: "test-key", baseUrl: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash", timeoutMs: 1000 },
    fetchImpl,
    researchTools
  });
  const events = [];
  const sources = await model.webSearch({
    companyName: "Example Bio",
    queries: ["clinical trial"],
    requestedTools: ["general_web_search", "clinical_trials_search"],
    onToolCall: (tool) => events.push(tool)
  });
  assert.equal(sources.length, 1);
  assert.ok(events.some((tool) => tool.name === "clinical_trials_search" && tool.status === "failed"));
});

test("a keyed research tool is skipped without making a request when credentials are absent", async () => {
  let fetchCalled = false;
  const model = createDeepSeekModelService({
    config: { apiKey: "test-key", baseUrl: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash", timeoutMs: 1000 },
    fetchImpl: async () => { fetchCalled = true; return new Response("{}"); },
    researchTools: { has: () => false }
  });
  const events = [];
  const sources = await model.webSearch({
    companyName: "Example Lab",
    requestedTools: ["openalex_research_search"],
    onToolCall: (tool) => events.push(tool)
  });
  assert.deepEqual(sources, []);
  assert.equal(fetchCalled, false);
  assert.ok(events.some((tool) => tool.name === "openalex_research_search" && tool.status === "skipped"));
});

test("SEC API failure falls back to a scoped Web Research query and marks its sources", async () => {
  let requestBody;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ content: [{
      type: "text",
      text: JSON.stringify([{ title: "Apple 10-K", url: "https://www.sec.gov/Archives/edgar/data/320193/example.htm", snippet: "Form 10-K filing" }])
    }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const researchTools = { has: () => true, run: async () => ({ ok: false, error: "SEC HTTP 403" }) };
  const model = createDeepSeekModelService({
    config: { apiKey: "test-key", baseUrl: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash", timeoutMs: 1000 },
    fetchImpl,
    researchTools
  });
  const events = [];
  const sources = await model.webSearch({
    companyName: "Apple Inc.",
    queries: ["Apple SEC 10-K revenue"],
    requestedTools: ["sec_filing_search"],
    onToolCall: (tool) => events.push(tool)
  });
  assert.equal(sources.length, 1);
  assert.match(sources[0].provider, /SEC API 降级/);
  assert.match(requestBody.messages[0].content, /site:sec\.gov\/Archives\/edgar\/data/);
  assert.ok(events.some((tool) => tool.status === "fallback"));
  assert.deepEqual(buildSecWebFallbackQueries({ companyName: "Apple", queries: ["Apple SEC 10-K"] }), [
    "Apple site:sec.gov/Archives/edgar/data 10-K 10-Q 8-K 20-F",
    "site:sec.gov Apple SEC 10-K"
  ]);
});

test("SEC fallback still fails visibly when Web Research is unavailable", async () => {
  const fetchImpl = async () => new Response("unavailable", { status: 400 });
  const researchTools = { has: () => true, run: async () => ({ ok: false, error: "SEC HTTP 403" }) };
  const model = createDeepSeekModelService({
    config: { apiKey: "test-key", baseUrl: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash", timeoutMs: 1000 },
    fetchImpl,
    researchTools
  });
  const events = [];
  await assert.rejects(model.webSearch({
    companyName: "Apple",
    requestedTools: ["sec_filing_search"],
    onToolCall: (tool) => events.push(tool)
  }), /SEC HTTP 403/);
  assert.ok(events.some((tool) => tool.status === "failed" && /Web Research/.test(tool.label)));
});

test("Agentic Search preserves cited text and claim links from tool results", () => {
  const sources = normalizeSearchSources({
    content: [{
      type: "text",
      text: JSON.stringify([{
        title: "Official filing",
        url: "https://www.sec.gov/Archives/example",
        snippet: "Revenue increased by 15 percent.",
        supports: ["claim_2"],
        conflicts: []
      }]),
      citations: [{ url: "https://www.sec.gov/Archives/example", title: "Official filing", cited_text: "Revenue increased by 15 percent." }]
    }]
  });
  assert.equal(sources.length, 1);
  assert.match(sources[0].snippet, /Revenue increased/);
  assert.deepEqual(sources[0].supports, ["claim_2"]);
});

test("empty general search automatically retries smaller focused query batches", async () => {
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    const text = requestCount === 1 ? "[]" : JSON.stringify([{
      title: "MiniMax 团队报道",
      url: `https://example.com/minimax-${requestCount}`,
      snippet: "公开报道提到目标团队成员的任职信息"
    }]);
    return new Response(JSON.stringify({ content: [{ type: "text", text }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  const model = createDeepSeekModelService({
    config: { apiKey: "test-key", baseUrl: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash", timeoutMs: 1000 },
    fetchImpl
  });
  const calls = [];
  const sources = await model.webSearch({
    companyName: "Copula Lab",
    queries: ["梁丽 MiniMax Agent", "蔡佳人 MiniMax", "Copula Lab", "AI 数据市场"],
    requestedTools: ["general_web_search"],
    onToolCall: (tool) => calls.push(tool.label)
  });
  assert.equal(requestCount, 3);
  assert.equal(sources.length, 2);
  assert.ok(calls.includes("公开网页搜索（聚焦重试）"));
  assert.deepEqual(focusedSearchBatches("Copula Lab", ["a", "b", "c"]), [["a", "b"], ["c"]]);
});

test("uncovered critical team members receive a dedicated identity search", async () => {
  let requestCount = 0;
  const requestBodies = [];
  const fetchImpl = async (_url, options) => {
    requestCount += 1;
    requestBodies.push(JSON.parse(options.body));
    const results = requestCount === 1
      ? [{ title: "行业资料", url: "https://example.com/market", snippet: "AI数据市场概览" }]
      : [{ title: "团队报道", url: "https://example.com/person", snippet: "公开报道确认梁丽担任MiniMax智能体产品负责人", supports: ["claim_1"] }];
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(results) }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  const model = createDeepSeekModelService({
    config: { apiKey: "test-key", baseUrl: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash", timeoutMs: 1000 },
    fetchImpl
  });
  const tools = [];
  const claims = [{ id: "claim_1", domain: "团队", importance: "critical", statement: "CEO梁丽前MiniMax Agent业务负责人", verificationNeed: "验证梁丽在MiniMax的任职经历" }];
  const queries = ["梁丽 MiniMax Agent 业务负责人", "AI 数据市场"];
  const sources = await model.webSearch({ companyName: "Copula Lab", queries, claims, requestedTools: ["general_web_search"], onToolCall: (tool) => tools.push(tool.label) });
  assert.equal(requestCount, 2);
  assert.ok(sources.some((source) => source.snippet.includes("梁丽")));
  assert.ok(tools.includes("团队履历核验（1/1）"));
  assert.equal(requestBodies[1].max_tokens, 4000);
  assert.match(requestBodies[1].messages[0].content, /claim_1/);
  assert.deepEqual(uncoveredTeamSearchQueries({ queries, claims, sources: [{ title: "行业资料", snippet: "市场概览" }] }), [queries[0]]);
});

test("dedicated identity evidence enriches a duplicate URL from general search", async () => {
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    const results = requestCount === 1
      ? [{ title: "MiniMax 团队报道", url: "https://example.com/minimax-team", snippet: "" }]
      : [{
          title: "MiniMax 团队报道",
          url: "https://example.com/minimax-team",
          snippet: "公开报道确认梁丽担任 MiniMax 智能体产品负责人",
          supports: ["claim_1"]
        }];
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(results) }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  const model = createDeepSeekModelService({
    config: { apiKey: "test-key", baseUrl: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash", timeoutMs: 1000 },
    fetchImpl
  });
  const sources = await model.webSearch({
    companyName: "Copula Lab",
    queries: ["梁丽 MiniMax Agent 业务负责人"],
    claims: [{ id: "claim_1", domain: "团队", importance: "critical", statement: "CEO梁丽前MiniMax Agent业务负责人", verificationNeed: "验证梁丽在MiniMax的任职经历" }],
    requestedTools: ["general_web_search"]
  });
  assert.equal(requestCount, 2);
  assert.equal(sources.length, 1);
  assert.match(sources[0].snippet, /梁丽/);
  assert.deepEqual(sources[0].supports, ["claim_1"]);
});
