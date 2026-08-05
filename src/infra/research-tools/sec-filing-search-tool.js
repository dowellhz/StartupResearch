import { boundedQueries, clean, researchSource } from "./research-tool-source.js";

const RELEVANT_FORMS = new Set(["10-K", "10-Q", "8-K", "20-F", "6-K", "S-1", "F-1"]);

export function createSecFilingSearchTool({ http, maxResults = 5 } = {}) {
  if (!http) throw new Error("SEC HTTP dependency is required");
  let tickersPromise;
  return {
    name: "sec_filing_search",
    async search(input = {}) {
      tickersPromise ||= http.getJson("https://www.sec.gov/files/company_tickers.json", { signal: input.signal });
      const tickers = await tickersPromise;
      const candidates = resolveCompanies(tickers, boundedQueries({ ...input, maxQueries: 2 })).slice(0, 2);
      const sources = [];
      for (const candidate of candidates) {
        const cik = String(candidate.cik_str || "").padStart(10, "0");
        const payload = await http.getJson(`https://data.sec.gov/submissions/CIK${cik}.json`, { signal: input.signal });
        sources.push(...sourcesFromSubmissions(payload, maxResults));
      }
      return sources;
    }
  };
}

export function resolveCompanies(payload, queries) {
  const values = Object.values(payload && typeof payload === "object" ? payload : {});
  const needles = queries.map(normalizeName).filter((value) => value.length >= 2);
  return values.map((item) => ({
    item,
    score: needles.reduce((score, needle) => Math.max(score, companyScore(item, needle)), 0)
  })).filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.item);
}

function companyScore(item, needle) {
  const title = normalizeName(item?.title);
  const ticker = normalizeName(item?.ticker);
  if (ticker && needle === ticker) return 100;
  if (title === needle) return 90;
  if (title.includes(needle) || needle.includes(title)) return 60;
  return 0;
}

function sourcesFromSubmissions(payload, maxResults) {
  const recent = payload?.filings?.recent || {};
  const forms = Array.isArray(recent.form) ? recent.form : [];
  const sources = [];
  for (let index = 0; index < forms.length && sources.length < maxResults; index += 1) {
    if (!RELEVANT_FORMS.has(forms[index])) continue;
    const accession = clean(recent.accessionNumber?.[index], 40);
    const document = clean(recent.primaryDocument?.[index], 300);
    if (!accession || !document) continue;
    const cik = String(payload.cik || "").replace(/^0+/, "");
    const archivePath = accession.replace(/-/g, "");
    sources.push(researchSource({
      title: `${payload.name || "SEC filer"} ${forms[index]} ${recent.filingDate?.[index] || ""}`,
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${archivePath}/${document}`,
      publishedAt: recent.filingDate?.[index] || "",
      provider: "SEC EDGAR",
      snippet: [
        `申报主体 ${payload.name || ""}`,
        payload.tickers?.length ? `证券代码 ${payload.tickers.join("、")}` : "",
        `表格 ${forms[index]}`,
        recent.reportDate?.[index] ? `报告期 ${recent.reportDate[index]}` : "",
        `Accession ${accession}`
      ].filter(Boolean).join("；")
    }));
  }
  return sources.filter(Boolean);
}

function normalizeName(value) {
  return clean(value, 300).toLowerCase().replace(/\b(incorporated|inc|corp|corporation|company|co|limited|ltd|plc)\b/g, "").replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}
