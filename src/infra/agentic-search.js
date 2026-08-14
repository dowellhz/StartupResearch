import { anthropicMessagesUrl } from "../config/runtime-config.js";
import { planStructuredResearchTools, researchToolDefinition, STRUCTURED_RESEARCH_TOOLS } from "../domain/research-tool-catalog.js";
import { buildSecWebFallbackQueries, SEC_WEB_FALLBACK_PROVIDER } from "../domain/research-tool-fallback.js";
import { expandLinkedPageSearch } from "./linked-page-search-orchestrator.js";
import { normalizeSearchSources, uniqueSources } from "./search-source-normalizer.js";

export function createAgenticSearchService({ config, apiKey, request, assertConfigured, researchTools = null, linkedPageResearch = null } = {}) {
  async function webSearch({ companyName, queries = [], claims = [], signal, onToolCall, requestedTools = [] } = {}) {
    const researchText = [companyName, ...queries].join(" ");
    const requested = new Set(requestedTools);
    const toolCalls = requested.size ? STRUCTURED_RESEARCH_TOOLS.filter((tool) => requested.has(tool.name)) : planAgenticSearchToolCalls(researchText);
    const sources = [];
    const failures = [];
    if (!toolCalls.length || requested.has("general_web_search")) {
      const generalTool = { name: "general_web_search", label: "公开网页搜索" };
      onToolCall?.(generalTool);
      try {
        const generalSources = await runAgenticSearch({ companyName, searchQueries: queries, claims, signal });
        sources.push(...generalSources);
        if (!generalSources.length) {
          onToolCall?.({ ...generalTool, label: "公开网页搜索（聚焦重试）" });
          for (const searchQueries of focusedSearchBatches(companyName, queries)) {
            sources.push(...await runAgenticSearch({ companyName, searchQueries, claims, signal }));
          }
        }
      } catch (error) {
        failures.push(error);
        notifyToolFailure(onToolCall, generalTool);
      }
      const teamQueries = uncoveredTeamSearchQueries({ queries, claims, sources });
      for (const [index, searchQuery] of teamQueries.entries()) {
        onToolCall?.({ name: "general_web_search", label: `团队履历核验（${index + 1}/${teamQueries.length}）` });
        try {
          const teamClaims = claims.filter((claim) => claim?.domain === "团队" && (
            extractTeamNames(claim.statement).some((name) => searchQuery.includes(name)) || searchQuery.includes(String(claim.verificationNeed || ""))
          )).map((claim) => ({ ...claim, statement: searchQuery, verificationNeed: searchQuery }));
          const focusedSources = await runAgenticSearch({ companyName, searchQueries: [searchQuery], claims: teamClaims.length ? teamClaims : claims.filter((claim) => claim?.domain === "团队"), signal, maxTokens: 4000 });
          const focusedClaimIds = teamClaims.map((claim) => claim.id).filter(Boolean);
          sources.push(...focusedSources.map((source) => source.snippet ? { ...source, supports: Array.from(new Set([...(source.supports || []), ...focusedClaimIds])) } : source));
        } catch (error) {
          failures.push(error);
          notifyToolFailure(onToolCall, { name: "general_web_search", label: "团队履历核验" });
        }
      }
    }
    for (const toolCall of toolCalls) {
      onToolCall?.(toolCall);
      if (researchTools && !researchTools.has?.(toolCall.name)) {
        notifyToolSkipped(onToolCall, toolCall);
        continue;
      }
      try {
        const input = { companyName, queries, claims, signal };
        const result = researchTools ? unwrapResearchToolResult(await researchTools.run(toolCall.name, input)) : await fallbackStructuredSearch(toolCall.name, input);
        sources.push(...result);
      } catch (error) {
        failures.push(error);
        notifyToolFailure(onToolCall, toolCall);
        if (toolCall.name === "sec_filing_search") await runSecFallback({ companyName, queries, claims, signal, sources, failures, onToolCall });
      }
    }
    if (!sources.length && failures.length) throw failures[0];
    const firstPassSources = uniqueSources(sources, 24);
    const expanded = await expandLinkedPageSearch({
      linkedPageResearch, companyName, sources: firstPassSources, claims, queries, signal, onToolCall,
      searchFallback: (searchQueries) => runAgenticSearch({ companyName, searchQueries, claims, signal })
    });
    return uniqueSources(expanded.sources, expanded.expanded ? 36 : 24);
  }

  async function runSecFallback({ companyName, queries, claims, signal, sources, failures, onToolCall }) {
    const fallbackTool = { name: "general_web_search", label: "SEC EDGAR（Web Research 降级）", status: "fallback" };
    onToolCall?.(fallbackTool);
    try {
      const fallbackSources = await runAgenticSearch({ companyName, searchQueries: buildSecWebFallbackQueries({ companyName, queries }), claims, signal });
      if (!fallbackSources.length) throw new Error("SEC Web Research fallback returned no sources");
      sources.push(...fallbackSources.map((source) => ({ ...source, provider: SEC_WEB_FALLBACK_PROVIDER })));
    } catch (error) {
      failures.push(error);
      notifyToolFailure(onToolCall, fallbackTool);
    }
  }

  async function clinicalTrialsSearch({ companyName, queries = [], claims = [], signal } = {}) {
    return runAgenticSearch({ companyName, searchQueries: buildAgenticSearchQueries({ companyName, queries, forceClinicalTrials: true }), claims, signal, clinicalTrials: true });
  }

  async function googleScholarSearch({ companyName, queries = [], claims = [], signal } = {}) {
    return runAgenticSearch({ companyName, searchQueries: buildGoogleScholarSearchQueries({ companyName, queries }), claims, signal, googleScholar: true });
  }

  async function fallbackStructuredSearch(name, input) {
    if (name === "clinical_trials_search") return clinicalTrialsSearch(input);
    if (name === "scholarly_works_search") return googleScholarSearch(input);
    return runAgenticSearch({ companyName: input.companyName, searchQueries: input.queries, claims: input.claims, signal: input.signal });
  }

  async function runAgenticSearch({ companyName, searchQueries, claims = [], signal, clinicalTrials = false, googleScholar = false, maxTokens = 2400 }) {
    assertConfigured();
    const response = await request(anthropicMessagesUrl(config.baseUrl), {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: Math.min(5, searchQueries.length || 1) }],
        messages: [{ role: "user", content: searchPrompt({ companyName, searchQueries, claims, clinicalTrials, googleScholar }) }]
      })
    });
    if (!response.ok) throw new Error(await responseError(response, "DeepSeek WebSearch"));
    return normalizeSearchSources(await response.json());
  }

  return { clinicalTrialsSearch, googleScholarSearch, webSearch };
}

function searchPrompt({ companyName, searchQueries, claims, clinicalTrials, googleScholar }) {
  return [
    `请为商业计划书核查联网搜索目标公司：${companyName || "未命名公司"}。`,
    ...searchQueries.map((query, index) => `${index + 1}. ${query}`),
    ...(claims.length ? ["需要核验的声明如下，supports/conflicts 必须填写对应的声明 id：", ...claims.slice(0, 16).map((claim) => `${claim.id}: ${claim.statement}`)] : []),
    "只保留与目标公司、团队、市场或竞争判断直接相关的网页。",
    "对高优先级声明同时寻找独立支持和反向证据；不得因为搜索不到就填写 conflicts。",
    "公司主体优先政府公示和监管记录；团队优先任职机构、论文、专利和正式采访；客户与收入优先客户官网、采购公告和上市公司披露；市场数据优先统计机构、监管机构和上市公司文件；技术壁垒优先专利、论文和监管记录。",
    ...(clinicalTrials ? ["这是临床试验专项检索，必须优先搜索 clinicaltrials.gov 的官方试验记录。", "对每项相关试验提取 NCT 编号、试验名称、阶段、当前状态、申办方、适应症、入组人数、主要终点和最近更新时间。", "ClinicalTrials.gov 未出现的内容不得写成官方登记事实。"] : []),
    ...(googleScholar ? ["这是 Google Scholar 学者专项检索，优先核对目标学者身份、机构、研究方向、论文和引用情况。", "如果 Scholar 返回 403 或验证码，不要重复直抓；查询搜索索引、DOI、ORCID、OpenAlex、出版社及高校主页交叉验证。", "无法从公开来源确认的引用数字必须标记为未核实，不得把同名作者的成果混入。"] : []),
    "如果目标 URL 拒绝直接访问，不要反复抓取；改查搜索索引、页面摘要及能交叉验证的关联公开页面。",
    "最终输出 JSON 数组，每项包含 title、url、snippet、supports、conflicts、publishedAt。",
    "snippet 必须是该网页直接支持核查的证据摘要或引用片段，不得只重复标题；supports/conflicts 使用声明 id 数组。"
  ].join("\n");
}

function notifyToolFailure(onToolCall, tool) { onToolCall?.({ ...tool, status: "failed", label: `${tool.label}（接口不可用，已继续其他检索）` }); }
function notifyToolSkipped(onToolCall, tool) { onToolCall?.({ ...tool, status: "skipped", label: `${tool.label}（未配置凭证，已跳过）` }); }
function unwrapResearchToolResult(result) {
  if (Array.isArray(result)) return result;
  if (result?.ok === true && Array.isArray(result.value)) return result.value;
  if (result?.ok === false) throw new Error(result.error || "structured research tool failed");
  throw new Error("structured research tool returned an invalid result");
}

export function needsClinicalTrialsSearch(value) { return /clinicaltrials\.gov|\bNCT\d{8}\b|临床试验|临床研究|药物管线|适应症|试验分期|\bphase\s*[1-4iIvV]+\b/i.test(String(value || "")); }
export function needsGoogleScholarSearch(value) { return /scholar\.google\.|google\s*scholar|谷歌学术|学者主页|学术引用/i.test(String(value || "")); }
export const AGENTIC_SEARCH_TOOLS = STRUCTURED_RESEARCH_TOOLS;
export function planAgenticSearchToolCalls(value) { return planStructuredResearchTools(value).map(researchToolDefinition).filter(Boolean); }
export function buildAgenticSearchQueries({ companyName = "", queries = [], forceClinicalTrials = false } = {}) {
  const base = uniqueStrings(queries);
  const combined = [companyName, ...base].join(" ");
  if (!forceClinicalTrials && !needsClinicalTrialsSearch(combined)) return base.slice(0, 5);
  const nctIds = Array.from(new Set(combined.match(/\bNCT\d{8}\b/gi) || [])).join(" ");
  const focus = nctIds || [companyName, ...base].join(" ").replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(new Set([`site:clinicaltrials.gov ${focus}`.trim().slice(0, 500), ...base])).slice(0, 5);
}
export function buildGoogleScholarSearchQueries({ companyName = "", queries = [] } = {}) {
  const base = uniqueStrings(queries);
  const combined = [companyName, ...base].join(" ");
  const ids = Array.from(new Set(Array.from(combined.matchAll(/[?&]user=([\w-]+)/gi), (match) => match[1])));
  const focus = ids.length ? ids.join(" ") : combined.replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(new Set([`site:scholar.google.com/citations ${focus}`.trim().slice(0, 500), ...base])).slice(0, 5);
}
export function focusedSearchBatches(companyName = "", queries = []) {
  const values = uniqueStrings(queries).slice(0, 5);
  if (!values.length && String(companyName || "").trim()) return [[String(companyName).trim()]];
  return values.length <= 2 ? [values] : [values.slice(0, 2), values.slice(2)];
}
export function uncoveredTeamSearchQueries({ queries = [], claims = [], sources = [] } = {}) {
  const material = sources.map((source) => `${source.title || ""} ${source.snippet || ""}`).join(" ");
  const values = [];
  for (const claim of claims.filter((item) => item?.domain === "团队" && ["critical", "high"].includes(item?.importance))) {
    if (sources.some((source) => (source.supports || []).includes(claim.id))) continue;
    const names = extractTeamNames(claim.statement);
    const missing = names.filter((name) => !material.includes(name));
    if (names.length && !missing.length) continue;
    for (const name of missing) values.push(queries.find((query) => String(query).includes(name)) || `${name} ${claim.verificationNeed || claim.statement}`);
    if (!names.length) values.push(claim.verificationNeed || claim.statement);
  }
  return uniqueStrings(values).slice(0, 3);
}

function extractTeamNames(value) {
  const names = [];
  const pattern = /(?:CEO|CTO|COO|CFO|CMO|创始人|联合创始人|负责人)\s*([\u3400-\u9fff]{2,4}?)(?=前|曾|现|为|，|、|\s|$)/gi;
  for (const match of String(value || "").matchAll(pattern)) names.push(match[1]);
  return Array.from(new Set(names));
}
function uniqueStrings(values) { return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean))); }
async function responseError(response, label) { const detail = String(await response.text()).slice(0, 500); return `${label} HTTP ${response.status}${detail ? `: ${detail}` : ""}`; }
