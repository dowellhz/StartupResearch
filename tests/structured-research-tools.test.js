import test from "node:test";
import assert from "node:assert/strict";
import { createArxivPaperSearchTool, parseArxivAtom } from "../src/infra/research-tools/arxiv-paper-search-tool.js";
import { createClinicalTrialsSearchTool } from "../src/infra/research-tools/clinical-trials-search-tool.js";
import { createGitHubRepositorySearchTool, createHuggingFaceAssetSearchTool } from "../src/infra/research-tools/open-source-footprint-tools.js";
import { createOpenAlexResearchTool } from "../src/infra/research-tools/openalex-research-tool.js";
import { createProcurementNoticeSearchTool } from "../src/infra/research-tools/procurement-notice-search-tool.js";
import { createResearchToolHttpClient } from "../src/infra/research-tools/research-tool-http-client.js";
import { createScholarlyWorksSearchTool } from "../src/infra/research-tools/scholarly-works-search-tool.js";
import { resolveCompanies, createSecFilingSearchTool } from "../src/infra/research-tools/sec-filing-search-tool.js";
import { createSoftwareVulnerabilitySearchTool, extractCveIds, extractPurls } from "../src/infra/research-tools/software-vulnerability-search-tool.js";
import { createStructuredResearchToolService } from "../src/infra/research-tools/structured-research-tool-service.js";

test("ClinicalTrials tool returns structured official study evidence", async () => {
  const http = fakeHttp({
    get: {
      studies: [{ protocolSection: {
        identificationModule: { nctId: "NCT01234567", briefTitle: "Target Study" },
        statusModule: { overallStatus: "RECRUITING", lastUpdatePostDateStruct: { date: "2026-07-01" } },
        sponsorCollaboratorsModule: { leadSponsor: { name: "Example Bio" } },
        designModule: { phases: ["PHASE2"], enrollmentInfo: { count: 80 } },
        conditionsModule: { conditions: ["Cancer"] },
        outcomesModule: { primaryOutcomes: [{ measure: "Overall response rate" }] }
      } }]
    }
  });
  const sources = await createClinicalTrialsSearchTool({ http, maxQueries: 1 }).search({ companyName: "Example Bio" });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].provider, "ClinicalTrials.gov");
  assert.match(sources[0].snippet, /NCT01234567.*RECRUITING.*Example Bio/);
});

test("Crossref tool returns DOI, authors and citation metadata", async () => {
  const http = fakeHttp({ get: { message: { items: [{
    DOI: "10.1000/example",
    title: ["Example Work"],
    author: [{ given: "Ada", family: "Lovelace" }],
    published: { "date-parts": [[2025, 6, 3]] },
    "container-title": ["Example Journal"],
    "is-referenced-by-count": 12,
    type: "journal-article"
  }] } } });
  const sources = await createScholarlyWorksSearchTool({ http, maxQueries: 1 }).search({ companyName: "Example Lab" });
  assert.equal(sources[0].url, "https://doi.org/10.1000/example");
  assert.match(sources[0].snippet, /Ada Lovelace.*被引 12/);
});

test("arXiv tool returns zero-key Atom paper metadata and abstract evidence", async () => {
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
    <id>http://arxiv.org/abs/2608.01234v1</id><updated>2026-08-03T10:00:00Z</updated><published>2026-08-02T10:00:00Z</published>
    <title> Efficient Edge AI </title><summary> A compact edge inference engine with measured results. </summary>
    <author><name>Ada Lovelace</name></author><author><name>Alan Turing</name></author>
    <category term="cs.AI"/><link title="pdf" href="https://arxiv.org/pdf/2608.01234v1" type="application/pdf"/>
  </entry></feed>`;
  let requestUrl;
  const http = { async getText(url) { requestUrl = new URL(url); return atom; } };
  const sources = await createArxivPaperSearchTool({ http, maxQueries: 1 }).search({ companyName: "Edge AI" });
  assert.equal(requestUrl.hostname, "export.arxiv.org");
  assert.match(requestUrl.searchParams.get("search_query"), /Edge AI/);
  assert.equal(sources[0].url, "https://arxiv.org/abs/2608.01234v1");
  assert.equal(sources[0].provider, "arXiv");
  assert.match(sources[0].snippet, /Ada Lovelace.*cs\.AI.*compact edge inference/i);
  assert.equal(parseArxivAtom(atom).length, 1);
});

test("OpenAlex tool uses its key and returns author and institution evidence", async () => {
  let requestUrl;
  const http = fakeHttp({ get: (url) => {
    requestUrl = new URL(url);
    return { results: [{
      id: "https://openalex.org/W123",
      doi: "https://doi.org/10.1000/openalex",
      display_name: "Example Research",
      publication_date: "2026-01-02",
      cited_by_count: 34,
      type: "article",
      authorships: [{ author: { display_name: "Ada Lovelace" }, institutions: [{ display_name: "Example University" }] }]
    }] };
  } });
  const sources = await createOpenAlexResearchTool({ http, apiKey: "openalex-test-key", maxQueries: 1 }).search({ companyName: "Example Lab" });
  assert.equal(requestUrl.searchParams.get("api_key"), "openalex-test-key");
  assert.equal(sources[0].provider, "OpenAlex");
  assert.match(sources[0].snippet, /Ada Lovelace.*Example University.*被引 34/);
});

test("GitHub and Hugging Face tools expose public technical footprint", async () => {
  const github = createGitHubRepositorySearchTool({ http: fakeHttp({ get: { items: [{
    full_name: "example/core", html_url: "https://github.com/example/core", description: "Core engine",
    language: "Rust", stargazers_count: 42, forks_count: 5, updated_at: "2026-08-01T00:00:00Z"
  }] } }), maxQueries: 1 });
  const huggingFace = createHuggingFaceAssetSearchTool({ http: fakeHttp({ get: [{
    id: "example/model", pipeline_tag: "text-generation", downloads: 1000, likes: 20, lastModified: "2026-08-02T00:00:00Z"
  }] }), maxQueries: 1 });
  const [repos, models] = await Promise.all([
    github.search({ companyName: "example" }),
    huggingFace.search({ companyName: "example" })
  ]);
  assert.match(repos[0].snippet, /Rust.*Stars 42/);
  assert.match(models[0].snippet, /text-generation.*1000/);
});

test("vulnerability tool uses exact OSV identifiers and bounded NVD keyword search", async () => {
  const calls = [];
  const http = {
    async getJson(url) {
      calls.push(String(url));
      if (String(url).includes("api.osv.dev")) return { id: "CVE-2025-12345", summary: "Example issue", affected: [] };
      return { vulnerabilities: [{ cve: { id: "CVE-2025-12345", published: "2025-01-01", descriptions: [{ lang: "en", value: "Example issue" }] } }] };
    },
    async postJson() {
      return { vulns: [] };
    }
  };
  const sources = await createSoftwareVulnerabilitySearchTool({ http, maxQueries: 1 }).search({ queries: ["CVE-2025-12345"] });
  assert.equal(calls.length, 2);
  assert.ok(sources.some((source) => source.provider === "OSV"));
  assert.ok(sources.some((source) => source.provider === "NVD"));
  assert.deepEqual(extractCveIds("x CVE-2025-12345"), ["CVE-2025-12345"]);
  assert.deepEqual(extractPurls("pkg:npm/lodash@4.17.20"), ["pkg:npm/lodash@4.17.20"]);
});

test("SEC tool resolves a public company and returns primary filing links", async () => {
  const tickers = { 0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } };
  assert.equal(resolveCompanies(tickers, ["Apple"])[0].ticker, "AAPL");
  let count = 0;
  const http = fakeHttp({ get: () => {
    count += 1;
    if (count === 1) return tickers;
    return {
      cik: "0000320193", name: "Apple Inc.", tickers: ["AAPL"], filings: { recent: {
        form: ["10-K"], filingDate: ["2025-10-31"], reportDate: ["2025-09-27"],
        accessionNumber: ["0000320193-25-000079"], primaryDocument: ["aapl-20250927.htm"]
      } }
    };
  } });
  const sources = await createSecFilingSearchTool({ http }).search({ companyName: "Apple" });
  assert.equal(sources.length, 1);
  assert.match(sources[0].url, /sec\.gov\/Archives\/edgar\/data\/320193/);
  assert.match(sources[0].snippet, /10-K/);
});

test("TED tool submits a bounded expert query and normalizes procurement evidence", async () => {
  let requestBody;
  const http = {
    async postJson(_url, body) {
      requestBody = body;
      return { notices: [{
        "publication-number": "123456-2026",
        "notice-title": { eng: "Robot procurement" },
        "publication-date": "2026-07-01",
        "buyer-name": { eng: "Example Buyer" },
        "winner-name": { eng: "Example Robotics" }
      }] };
    }
  };
  const sources = await createProcurementNoticeSearchTool({ http, maxQueries: 1 }).search({ companyName: "Example Robotics" });
  assert.match(requestBody.query, /^FT ~/);
  assert.equal(sources.length, 1);
  assert.match(sources[0].snippet, /Example Buyer.*Example Robotics/);
});

test("structured research service dispatches only registered tools", async () => {
  const service = createStructuredResearchToolService({ tools: [
    { name: "demo", search: async () => [{ url: "https://example.com" }] },
    { name: "broken", search: async () => { throw new Error("upstream failed"); } }
  ] });
  assert.deepEqual(service.names(), ["demo", "broken"]);
  assert.equal(service.has("demo"), true);
  assert.deepEqual(await service.run("demo"), { ok: true, value: [{ url: "https://example.com" }] });
  assert.deepEqual(await service.run("broken"), { ok: false, error: "upstream failed", tool: "broken" });
  assert.deepEqual(await service.run("missing"), { ok: false, error: "unsupported structured research tool: missing", tool: "missing" });
});

test("structured research service registers OpenAlex only when its key is configured", () => {
  const withoutKey = createStructuredResearchToolService({ fetchImpl: async () => new Response("{}") });
  const withKey = createStructuredResearchToolService({
    fetchImpl: async () => new Response("{}"),
    credentials: { openAlexApiKey: "openalex-test-key" }
  });
  assert.equal(withoutKey.has("openalex_research_search"), false);
  assert.equal(withoutKey.has("arxiv_paper_search"), true);
  assert.deepEqual(withoutKey.keyedStatus(), { openalex_research_search: false });
  assert.equal(withKey.has("openalex_research_search"), true);
  assert.deepEqual(withKey.keyedStatus(), { openalex_research_search: true });
  assert.equal(withKey.zeroKeyNames().includes("openalex_research_search"), false);
  assert.equal(withKey.zeroKeyNames().includes("arxiv_paper_search"), true);
});

test("research tool HTTP client retries temporary failures without auth headers", async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push(options);
    if (requests.length === 1) return new Response("busy", { status: 503 });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const http = createResearchToolHttpClient({ fetchImpl, maxAttempts: 2, timeoutMs: 1000 });
  assert.deepEqual(await http.getJson("https://example.com/public"), { ok: true });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers.Authorization, undefined);
  assert.match(requests[0].headers["User-Agent"], /VentureLens/);
  const text = await createResearchToolHttpClient({ fetchImpl: async () => new Response("<feed />"), maxAttempts: 1, timeoutMs: 1000 })
    .getText("https://example.com/feed");
  assert.equal(text, "<feed />");
});

function fakeHttp({ get } = {}) {
  return {
    async getJson(url) {
      return typeof get === "function" ? get(url) : structuredClone(get);
    },
    async postJson() {
      return {};
    }
  };
}
