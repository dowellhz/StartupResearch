import { boundedQueries, clean, researchSource } from "./research-tool-source.js";

export function createArxivPaperSearchTool({ http, maxQueries = 1, maxResults = 4 } = {}) {
  if (!http?.getText) throw new Error("arXiv text HTTP dependency is required");
  return {
    name: "arxiv_paper_search",
    async search(input = {}) {
      const sources = [];
      for (const query of boundedQueries({ ...input, maxQueries })) {
        const url = new URL("https://export.arxiv.org/api/query");
        url.searchParams.set("search_query", `all:\"${sanitizeQuery(query)}\"`);
        url.searchParams.set("start", "0");
        url.searchParams.set("max_results", String(maxResults));
        url.searchParams.set("sortBy", "relevance");
        const atom = await http.getText(url, { signal: input.signal, headers: { Accept: "application/atom+xml" } });
        sources.push(...parseArxivAtom(atom).map(sourceFromEntry).filter(Boolean));
      }
      return uniqueByUrl(sources);
    }
  };
}

export function parseArxivAtom(value) {
  const text = String(value || "");
  return Array.from(text.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi), (match) => {
    const entry = match[1];
    return {
      id: tagText(entry, "id"),
      title: tagText(entry, "title"),
      summary: tagText(entry, "summary"),
      published: tagText(entry, "published"),
      updated: tagText(entry, "updated"),
      authors: Array.from(entry.matchAll(/<author\b[^>]*>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi), (item) => xmlText(item[1])),
      categories: Array.from(entry.matchAll(/<category\b[^>]*term=["']([^"']+)["'][^>]*\/?\s*>/gi), (item) => xmlText(item[1])),
      links: Array.from(entry.matchAll(/<link\b([^>]+)>/gi), (item) => attributes(item[1]))
    };
  });
}

function sourceFromEntry(entry) {
  const arxivId = clean(String(entry.id || "").replace(/^https?:\/\/(?:export\.)?arxiv\.org\/abs\//i, ""), 80);
  const abstractUrl = arxivId ? `https://arxiv.org/abs/${arxivId}` : entry.links.find((link) => link.rel === "alternate")?.href;
  const pdfUrl = entry.links.find((link) => link.title === "pdf" || link.type === "application/pdf")?.href;
  const summary = clean(entry.summary, 1200);
  return researchSource({
    title: entry.title || arxivId || "arXiv paper",
    url: abstractUrl,
    publishedAt: entry.published || entry.updated,
    provider: "arXiv",
    snippet: [
      entry.authors.length ? `作者 ${entry.authors.slice(0, 10).join("、")}` : "",
      entry.categories.length ? `分类 ${entry.categories.slice(0, 8).join("、")}` : "",
      summary ? `摘要 ${summary}` : "",
      pdfUrl ? `PDF ${pdfUrl}` : ""
    ].filter(Boolean).join("；")
  });
}

function tagText(xml, tag) {
  const match = String(xml).match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? xmlText(match[1]) : "";
}

function attributes(value) {
  const result = {};
  for (const match of String(value).matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) result[match[1]] = xmlText(match[2]);
  return result;
}

function xmlText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

function sanitizeQuery(value) {
  return clean(value, 240).replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
}

function uniqueByUrl(values) {
  return Array.from(new Map(values.filter(Boolean).map((item) => [item.url, item])).values());
}
