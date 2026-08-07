import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPublicUrl,
  createLinkedPageResearchService,
  extractPageLinks
} from "../src/infra/linked-page-research-service.js";

const PUBLIC_DNS = async () => ["93.184.216.34"];

test("linked-page research follows only relevant links at depth one and extracts PDF evidence", async () => {
  const requested = [];
  const fetchImpl = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url === "https://example.com/") return html(`
      <html><head><title>示例科技官网</title></head><body>
      <p>示例科技提供边缘 AI 产品。</p>
      <a href="/team">核心团队</a><a href="/papers/edge-ai.pdf">技术论文 PDF</a>
      <a href="/privacy">隐私政策</a><a href="https://unrelated.test/shop">在线商店</a>
      </body></html>`);
    if (url === "https://example.com/team") return html("<html><title>核心团队</title><body>创始人张三为高校教授，团队研究边缘 AI。</body></html>");
    if (url === "https://example.com/papers/edge-ai.pdf") return new Response("mock-pdf", { status: 200, headers: { "Content-Type": "application/pdf" } });
    return new Response("not found", { status: 404 });
  };
  const documentExtractor = {
    extract: async ({ filename }) => ({ ok: true, value: { text: `${filename} 论文说明模型压缩率和边缘 AI 实验结果。` } })
  };
  const service = createLinkedPageResearchService({ fetchImpl, resolveHostname: PUBLIC_DNS, documentExtractor });
  const result = await service.expand({
    companyName: "示例科技",
    queries: ["示例科技 团队 技术论文"],
    sources: [{ title: "官网", url: "https://example.com/", snippet: "示例科技官网", sourceTier: "primary" }]
  });
  assert.equal(result.stats.parentFetched, 1);
  assert.equal(result.stats.childFetched, 2);
  assert.ok(result.sources.some((source) => source.url === "https://example.com/team" && source.depth === 1));
  assert.ok(result.sources.some((source) => source.url.endsWith("edge-ai.pdf") && /模型压缩率/.test(source.snippet)));
  assert.ok(result.sources.every((source) => source.verificationStatus === "verified"));
  assert.ok(result.sources.every((source) => /^[a-f0-9]{64}$/.test(source.contentHash)));
  assert.equal(requested.includes("https://example.com/privacy"), false);
  assert.equal(requested.includes("https://unrelated.test/shop"), false);
  assert.ok(result.sources.filter((source) => source.depth === 1).every((source) => source.discoveredFrom === "https://example.com/"));
});

test("linked-page research blocks private networks before fetch", async () => {
  let fetched = false;
  const service = createLinkedPageResearchService({
    fetchImpl: async () => { fetched = true; return html("private"); },
    resolveHostname: async () => ["127.0.0.1"]
  });
  const result = await service.expand({ sources: [{ title: "internal", url: "http://internal.example/admin", snippet: "internal" }] });
  assert.equal(fetched, false);
  assert.equal(result.stats.blocked, 1);
  assert.deepEqual(result.fallbackQueries, []);
  await assert.rejects(assertPublicUrl("http://127.0.0.1/private", PUBLIC_DNS), /private network/);
});

test("linked-page research turns a public 403 into a bounded focused-search query", async () => {
  const service = createLinkedPageResearchService({
    fetchImpl: async () => new Response("forbidden", { status: 403 }),
    resolveHostname: PUBLIC_DNS
  });
  const result = await service.expand({
    companyName: "示例科技",
    sources: [{ title: "示例科技团队", url: "https://example.com/team", snippet: "团队信息" }]
  });
  assert.equal(result.stats.failed, 1);
  assert.equal(result.fallbackQueries.length, 1);
  assert.match(result.fallbackQueries[0], /^site:example\.com/);
});

test("linked-page research enforces the global and per-parent page budgets", async () => {
  const requested = [];
  const fetchImpl = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url === "https://example.com/") {
      return html(`<body>${Array.from({ length: 6 }, (_, index) => `<a href="/research-${index}">技术研究论文 ${index}</a>`).join("")}</body>`);
    }
    return html(`<body>示例科技技术研究页面 ${url}</body>`);
  };
  const service = createLinkedPageResearchService({
    fetchImpl,
    resolveHostname: PUBLIC_DNS,
    limits: { maxDiscoveredPages: 2, maxLinksPerParent: 2, maxPagesPerHost: 2 }
  });
  const result = await service.expand({
    companyName: "示例科技",
    sources: [{ title: "官网", url: "https://example.com/", snippet: "示例科技", sourceTier: "primary" }]
  });
  assert.equal(result.stats.childFetched, 2);
  assert.equal(requested.length, 3);
});

test("link extraction resolves relative URLs and honors nofollow", () => {
  const links = extractPageLinks(`
    <a href="../team?x=1#bio" title="Leadership">团队</a>
    <a href="/blocked" rel="nofollow">blocked</a>
    <a href="mailto:test@example.com">mail</a>
  `, new URL("https://example.com/about/index.html"));
  assert.deepEqual(links.map((item) => item.url), ["https://example.com/team?x=1"]);
});

function html(value) {
  return new Response(value, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
