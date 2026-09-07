import test from "node:test";
import assert from "node:assert/strict";
import { createModelUsageMeter, normalizeUsage } from "../src/infra/model-usage-meter.js";
import { createDeepSeekModelService } from "../src/infra/deepseek-model-service.js";

const MODEL_CONFIG = { apiKey: "k", baseUrl: "https://api.deepseek.com/chat/completions", model: "deepseek-chat", timeoutMs: 1000 };

function sseResponse(chunks) {
  return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join("\n\n")}\n\ndata: [DONE]\n\n`, { status: 200 });
}

test("OpenAI 与 Anthropic 两种 usage 结构都能归一", () => {
  assert.deepEqual(normalizeUsage({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }), { promptTokens: 10, completionTokens: 4, totalTokens: 14 });
  assert.deepEqual(normalizeUsage({ input_tokens: 7, output_tokens: 3 }), { promptTokens: 7, completionTokens: 3, totalTokens: 10 });
  assert.equal(normalizeUsage(null), null);
  assert.equal(normalizeUsage({}), null);
  assert.equal(normalizeUsage({ prompt_tokens: 0, completion_tokens: 0 }), null);
});

test("计量器按 scope 汇总当日 token 并写入审计日志", () => {
  const audits = [];
  const meter = createModelUsageMeter({ logger: { audit: (event, fields) => audits.push([event, fields]) }, now: () => new Date("2026-09-07T01:00:00Z") });
  meter.record({ prompt_tokens: 100, completion_tokens: 20 }, { scope: "complete", model: "deepseek-chat" });
  meter.record({ input_tokens: 50, output_tokens: 10 }, { scope: "agentic_search" });
  assert.equal(meter.record(undefined, { scope: "complete" }), null);

  const snapshot = meter.snapshot();
  assert.equal(snapshot.day, "2026-09-07");
  assert.equal(snapshot.calls, 2);
  assert.equal(snapshot.totalTokens, 180);
  assert.deepEqual(snapshot.byScope, { complete: 120, agentic_search: 60 });
  assert.equal(audits.length, 2);
  assert.deepEqual(audits[0], ["model.usage", { scope: "complete", model: "deepseek-chat", promptTokens: 100, completionTokens: 20, totalTokens: 120 }]);
});

test("跨自然日自动归零，避免把昨天的消耗算进今天", () => {
  let clock = new Date("2026-09-07T23:00:00Z");
  const meter = createModelUsageMeter({ logger: {}, now: () => clock });
  meter.record({ total_tokens: 500 }, { scope: "complete" });
  assert.equal(meter.snapshot().totalTokens, 500);
  clock = new Date("2026-09-08T01:00:00Z");
  assert.deepEqual(meter.snapshot(), { day: "2026-09-08", calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, byScope: {} });
});

test("非流式补全上报真实 token", async () => {
  const recorded = [];
  const model = createDeepSeekModelService({
    config: MODEL_CONFIG,
    usageMeter: { record: (usage, meta) => recorded.push([usage, meta]) },
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 }
    }), { status: 200 })
  });
  assert.equal(await model.complete([{ role: "user", content: "hi" }]), "ok");
  assert.deepEqual(recorded[0][0], { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 });
  assert.deepEqual(recorded[0][1], { scope: "complete", model: "deepseek-chat" });
});

test("流式回答请求 include_usage 并从末尾 chunk 取回 token", async () => {
  const bodies = [];
  const recorded = [];
  const model = createDeepSeekModelService({
    config: MODEL_CONFIG,
    usageMeter: { record: (usage, meta) => recorded.push([usage, meta]) },
    fetchImpl: async (url, options) => {
      bodies.push(JSON.parse(options.body));
      return sseResponse([
        { choices: [{ delta: { content: "答" } }] },
        { choices: [{ delta: { content: "案" } }] },
        { choices: [], usage: { prompt_tokens: 30, completion_tokens: 2, total_tokens: 32 } }
      ]);
    }
  });
  assert.equal(await model.stream([{ role: "user", content: "hi" }]), "答案");
  assert.deepEqual(bodies[0].stream_options, { include_usage: true });
  assert.deepEqual(recorded[0][0], { prompt_tokens: 30, completion_tokens: 2, total_tokens: 32 });
  assert.deepEqual(recorded[0][1], { scope: "stream", model: "deepseek-chat" });
});

test("网关拒绝 stream_options 时降级重试，回答不受影响", async () => {
  const bodies = [];
  const model = createDeepSeekModelService({
    config: MODEL_CONFIG,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      if (body.stream_options) return new Response(JSON.stringify({ error: "unknown field stream_options" }), { status: 400 });
      return sseResponse([{ choices: [{ delta: { content: "降级答案" } }] }]);
    }
  });
  assert.equal(await model.stream([{ role: "user", content: "hi" }]), "降级答案");
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].stream_options, undefined);
});

test("Agentic Search 的 token 也计入，且标记为独立 scope", async () => {
  const recorded = [];
  const model = createDeepSeekModelService({
    config: MODEL_CONFIG,
    usageMeter: { record: (usage, meta) => recorded.push([usage, meta]) },
    fetchImpl: async () => new Response(JSON.stringify({
      content: [{ type: "text", text: "[]" }],
      usage: { input_tokens: 900, output_tokens: 120 }
    }), { status: 200 })
  });
  await model.webSearch({ companyName: "Example", queries: ["Example"], requestedTools: ["general_web_search"] });
  const search = recorded.find(([, meta]) => meta.scope === "agentic_search");
  assert.deepEqual(search[0], { input_tokens: 900, output_tokens: 120 });
});
