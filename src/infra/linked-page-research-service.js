import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createHash } from "node:crypto";

const DEFAULT_LIMITS = Object.freeze({
  maxParentPages: 6,
  maxLinksPerParent: 3,
  maxDiscoveredPages: 10,
  maxPagesPerHost: 3,
  concurrency: 3,
  timeoutMs: 7000,
  maxHtmlBytes: 1_500_000,
  maxPdfBytes: 6_000_000,
  maxRedirects: 3
});

const RESEARCH_LINK_TERMS = [
  "关于", "公司", "团队", "创始人", "管理层", "专家", "教授", "产品", "技术", "论文", "研究", "成果",
  "客户", "案例", "合作", "伙伴", "新闻", "公告", "融资", "投资者", "招标", "采购", "中标", "报告",
  "about", "company", "team", "founder", "leadership", "people", "product", "technology", "research", "paper",
  "publication", "customer", "case", "partner", "news", "press", "investor", "funding", "tender", "procurement", "report"
];

const REJECT_LINK_PATTERN = /(?:登录|注册|隐私|条款|招聘|cookie|sign[ -]?in|log[ -]?in|register|privacy|terms|career|javascript:|mailto:|tel:)/i;

export function createLinkedPageResearchService({
  fetchImpl = globalThis.fetch,
  resolveHostname = resolvePublicHostname,
  documentExtractor,
  limits = {}
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("linked page fetch dependency is required");
  const budget = { ...DEFAULT_LIMITS, ...limits };

  async function expand({ companyName = "", sources = [], claims = [], queries = [], signal, onProgress } = {}) {
    const terms = buildResearchTerms({ companyName, claims, queries });
    const parents = prioritizeParents(sources, companyName).slice(0, budget.maxParentPages);
    const stats = { parentSelected: parents.length, parentFetched: 0, linksConsidered: 0, childFetched: 0, blocked: 0, failed: 0 };
    const fallbackQueries = [];
    onProgress?.(`正在检查 ${parents.length} 个高价值页面中的相关链接…`);

    const parentResults = await mapLimited(parents, budget.concurrency, async (source) => {
      const page = await fetchPage(source.url, { signal });
      if (!page.ok) {
        recordFailure(page, stats);
        if (!page.blocked) addFallbackQuery(fallbackQueries, source.title, source.url, terms);
        return null;
      }
      stats.parentFetched += 1;
      return { source, page };
    });

    const enriched = [];
    const candidates = [];
    for (const result of parentResults.filter(Boolean)) {
      const { source, page } = result;
      if (page.text) enriched.push(pageSource(page, { source, terms, depth: 0 }));
      for (const link of page.links || []) {
        const candidate = scoreLink(link, { parentUrl: page.url, terms, companyName });
        if (candidate) candidates.push(candidate);
      }
    }

    const selected = selectCandidates(candidates, {
      existingUrls: new Set(sources.map((source) => canonicalUrl(source.url)).filter(Boolean)),
      maxPages: budget.maxDiscoveredPages,
      maxPerHost: budget.maxPagesPerHost,
      maxPerParent: budget.maxLinksPerParent
    });
    stats.linksConsidered = candidates.length;
    if (selected.length) onProgress?.(`已发现 ${selected.length} 个相关链接，正在进行一层下钻…`);

    const children = await mapLimited(selected, budget.concurrency, async (candidate) => {
      const page = await fetchPage(candidate.url, { signal });
      if (!page.ok) {
        recordFailure(page, stats);
        if (!page.blocked) addFallbackQuery(fallbackQueries, candidate.anchor, candidate.url, terms);
        return null;
      }
      stats.childFetched += 1;
      return pageSource(page, { source: candidate, terms, depth: 1, discoveredFrom: candidate.parentUrl });
    });
    onProgress?.(`二级搜索完成：读取 ${stats.parentFetched} 个一级页面、${stats.childFetched} 个关联页面`);
    return {
      sources: [...enriched.filter(Boolean), ...children.filter(Boolean)],
      fallbackQueries: fallbackQueries.slice(0, 2),
      stats,
      warning: stats.failed || stats.blocked ? `有 ${stats.failed + stats.blocked} 个页面拒绝访问或抓取失败，已保留搜索降级线索` : ""
    };
  }

  async function fetchPage(input, { signal } = {}) {
    let url;
    try {
      url = await assertPublicUrl(input, resolveHostname);
    } catch (error) {
      return { ok: false, status: 0, error: error.message, blocked: true, url: String(input || "") };
    }
    for (let redirects = 0; redirects <= budget.maxRedirects; redirects += 1) {
      let response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          redirect: "manual",
          signal: combinedSignal(signal, budget.timeoutMs),
          headers: {
            Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.1",
            "User-Agent": "VentureLens/0.1 (+https://github.com/dowellhz/StartupResearch)"
          }
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        return { ok: false, status: 0, error: error.message, url: url.toString() };
      }
      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        await discardBody(response);
        if (!location || redirects === budget.maxRedirects) return { ok: false, status: response.status, error: "redirect budget exceeded", url: url.toString() };
        try {
          url = await assertPublicUrl(new URL(location, url), resolveHostname);
          continue;
        } catch (error) {
          return { ok: false, status: response.status, error: error.message, blocked: true, url: url.toString() };
        }
      }
      if (!response.ok) {
        await discardBody(response);
        return { ok: false, status: response.status, error: `HTTP ${response.status}`, url: url.toString() };
      }
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      const pdf = contentType.includes("application/pdf") || /\.pdf(?:$|[?#])/i.test(url.pathname);
      if (pdf) return readPdfPage(response, url, contentType, signal);
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml") && contentType) {
        await discardBody(response);
        return { ok: false, status: 415, error: `unsupported content type ${contentType}`, url: url.toString() };
      }
      try {
        const buffer = await readLimitedBody(response, budget.maxHtmlBytes);
        const html = new TextDecoder(contentCharset(contentType)).decode(buffer);
        return {
          ok: true,
          url: url.toString(),
          contentType: contentType || "text/html",
          title: extractTitle(html),
          text: htmlToText(html),
          links: extractPageLinks(html, url)
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        return { ok: false, status: 422, error: error.message, url: url.toString() };
      }
    }
    return { ok: false, status: 0, error: "redirect budget exceeded", url: url.toString() };
  }

  async function readPdfPage(response, url, contentType, signal) {
    if (!documentExtractor) return { ok: false, status: 415, error: "PDF extractor unavailable", url: url.toString() };
    try {
      const buffer = await readLimitedBody(response, budget.maxPdfBytes);
      const result = await documentExtractor.extract({ buffer, filename: filenameFromUrl(url), mimeType: "application/pdf" }, { signal });
      if (!result?.ok) return { ok: false, status: 422, error: result?.error || "PDF extraction failed", url: url.toString() };
      return { ok: true, url: url.toString(), contentType, title: filenameFromUrl(url), text: result.value?.text || "", links: [] };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { ok: false, status: 422, error: error.message, url: url.toString() };
    }
  }

  return { expand, fetchPage };
}

export async function assertPublicUrl(input, resolveHostname = resolvePublicHostname) {
  const url = input instanceof URL ? new URL(input) : new URL(String(input || ""));
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("only public HTTP URLs may be crawled");
  if (url.username || url.password) throw new Error("credentialed URLs may not be crawled");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("non-standard ports may not be crawled");
  url.hash = "";
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("local hostnames may not be crawled");
  }
  const addresses = isIP(hostname) ? [hostname] : await resolveHostname(hostname);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error("private network addresses may not be crawled");
  return url;
}

export function extractPageLinks(html, baseUrl) {
  const links = [];
  for (const match of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = htmlAttributes(match[1]);
    if (!attrs.href || /nofollow/i.test(attrs.rel || "")) continue;
    const anchor = htmlToText(match[2]).slice(0, 300);
    if (REJECT_LINK_PATTERN.test(`${anchor} ${attrs.href}`)) continue;
    try {
      const url = new URL(decodeHtml(attrs.href), baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      url.hash = "";
      links.push({ url: url.toString(), anchor, title: decodeHtml(attrs.title || "") });
    } catch {}
  }
  return links;
}

export function buildResearchTerms({ companyName = "", claims = [], queries = [] } = {}) {
  const material = [companyName, ...queries, ...claims.flatMap((claim) => [claim?.statement, claim?.verificationNeed])].join(" ");
  const extracted = material.match(/[a-z0-9][a-z0-9._-]{2,}|[\u3400-\u9fff]{2,12}/gi) || [];
  const companyAliases = [companyName, String(companyName).replace(/(?:股份)?有限公司|有限责任公司|科技|集团/g, "")];
  return Array.from(new Set([...companyAliases, ...RESEARCH_LINK_TERMS, ...extracted]
    .map((term) => normalizeText(term)).filter((term) => term.length >= 2))).slice(0, 80);
}

function prioritizeParents(sources, companyName) {
  const company = normalizeText(companyName);
  const rank = { primary: 4, secondary: 2, lead: 0 };
  return [...sources].filter((source) => canonicalUrl(source?.url)).sort((left, right) => parentScore(right) - parentScore(left));
  function parentScore(source) {
    let score = rank[source.sourceTier] || 0;
    const material = normalizeText(`${source.title} ${source.url} ${source.snippet}`);
    if (company && material.includes(company)) score += 5;
    try {
      const path = new URL(source.url).pathname;
      if (path === "/" || path.split("/").filter(Boolean).length <= 1) score += 2;
    } catch {}
    return score;
  }
}

function scoreLink(link, { parentUrl, terms, companyName }) {
  const material = normalizeText(`${link.anchor} ${link.title} ${link.url}`);
  if (!material || REJECT_LINK_PATTERN.test(material)) return null;
  let score = 0;
  const company = normalizeText(companyName);
  if (company && material.includes(company)) score += 5;
  for (const term of terms) if (material.includes(term)) score += RESEARCH_LINK_TERMS.includes(term) ? 1 : 2;
  try {
    const child = new URL(link.url);
    const parent = new URL(parentUrl);
    if (child.hostname === parent.hostname) score += 1;
    if (/\.pdf$/i.test(child.pathname)) score += 2;
  } catch {
    return null;
  }
  return score >= 2 ? { ...link, parentUrl, score } : null;
}

function selectCandidates(candidates, { existingUrls, maxPages, maxPerHost, maxPerParent }) {
  const selected = [];
  const seen = new Set(existingUrls);
  const perHost = new Map();
  const perParent = new Map();
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    const url = canonicalUrl(candidate.url);
    if (!url || seen.has(url)) continue;
    const host = new URL(url).hostname;
    if ((perHost.get(host) || 0) >= maxPerHost || (perParent.get(candidate.parentUrl) || 0) >= maxPerParent) continue;
    seen.add(url);
    perHost.set(host, (perHost.get(host) || 0) + 1);
    perParent.set(candidate.parentUrl, (perParent.get(candidate.parentUrl) || 0) + 1);
    selected.push({ ...candidate, url });
    if (selected.length >= maxPages) break;
  }
  return selected;
}

function pageSource(page, { source, terms, depth, discoveredFrom = "" }) {
  const snippet = evidenceExcerpt(page.text, terms);
  if (!snippet) return null;
  return {
    title: page.title || source.title || source.anchor || page.url,
    url: page.url,
    snippet,
    supports: [],
    conflicts: [],
    provider: depth ? "页面二级发现" : (source.provider || "页面正文抓取"),
    discoveredFrom,
    depth,
    contentType: page.contentType,
    verificationStatus: "verified",
    contentHash: createHash("sha256").update(String(page.text || ""), "utf8").digest("hex")
  };
}

function evidenceExcerpt(text, terms) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length < 20) return "";
  const lower = value.toLowerCase();
  let index = -1;
  for (const term of terms) {
    const found = lower.indexOf(term.toLowerCase());
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  const start = Math.max(0, (index < 0 ? 0 : index) - 250);
  return value.slice(start, start + 1600);
}

function extractTitle(html) {
  const title = String(html || "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    || String(html || "").match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    || "";
  return htmlToText(title).slice(0, 500);
}

function htmlToText(value) {
  return decodeHtml(String(value || "")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(?:br|p|div|li|h[1-6]|tr|section|article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function htmlAttributes(value) {
  const result = {};
  for (const match of String(value).matchAll(/([\w:-]+)\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/g)) result[match[1].toLowerCase()] = match[2] ?? match[3] ?? "";
  return result;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

async function readLimitedBody(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error(`page exceeds ${maxBytes} byte budget`);
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`page exceeds ${maxBytes} byte budget`);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`page exceeds ${maxBytes} byte budget`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function discardBody(response) {
  try {
    await response.body?.cancel?.();
  } catch {}
}

async function mapLimited(values, concurrency, handler) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await handler(values[index], index);
    }
  }));
  return results;
}

async function resolvePublicHostname(hostname) {
  return (await lookup(hostname, { all: true, verbatim: true })).map((item) => item.address);
}

function isPrivateAddress(value) {
  const address = String(value || "").toLowerCase();
  if (address === "::1" || address === "::" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  if (address.startsWith("::ffff:")) return isPrivateAddress(address.slice(7));
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168)) || (a === 100 && b >= 64 && b <= 127)
    || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0) || a >= 224;
}

function addFallbackQuery(values, title, value, terms) {
  try {
    const url = new URL(value);
    const focus = [title, ...terms.slice(0, 4)].filter(Boolean).join(" ").slice(0, 300);
    values.push(`site:${url.hostname} ${focus}`.trim());
  } catch {}
}

function recordFailure(page, stats) {
  if (page.blocked) stats.blocked += 1;
  else stats.failed += 1;
}

function filenameFromUrl(url) {
  return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "document.pdf").slice(0, 200);
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}

function combinedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function contentCharset(contentType) {
  return /charset=gb(?:k|2312|18030)/i.test(contentType) ? "gb18030" : "utf-8";
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}
