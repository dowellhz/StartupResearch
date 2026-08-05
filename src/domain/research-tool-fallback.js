export const SEC_WEB_FALLBACK_PROVIDER = "DeepSeek Web Research（SEC API 降级）";

export function buildSecWebFallbackQueries({ companyName = "", queries = [] } = {}) {
  const company = cleanQuery(companyName, 250);
  const relevant = (Array.isArray(queries) ? queries : [])
    .map((query) => cleanQuery(query, 500))
    .filter((query) => /SEC|EDGAR|10-K|10-Q|8-K|20-F|6-K|S-1|F-1|美股|美国上市|上市公司披露/i.test(query));
  return Array.from(new Set([
    `${company} site:sec.gov/Archives/edgar/data 10-K 10-Q 8-K 20-F`.trim(),
    ...relevant.map((query) => `site:sec.gov ${query}`)
  ].filter((query) => query.length >= 2))).slice(0, 3);
}

function cleanQuery(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
