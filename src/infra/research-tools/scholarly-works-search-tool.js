import { boundedQueries, clean, researchSource } from "./research-tool-source.js";

export function createScholarlyWorksSearchTool({ http, maxQueries = 2, maxResults = 4 } = {}) {
  if (!http) throw new Error("Crossref HTTP dependency is required");
  return {
    name: "scholarly_works_search",
    async search(input = {}) {
      const sources = [];
      for (const query of boundedQueries({ ...input, maxQueries })) {
        const url = new URL("https://api.crossref.org/works");
        url.searchParams.set("query.bibliographic", query);
        url.searchParams.set("rows", String(maxResults));
        url.searchParams.set("select", "DOI,title,author,published,container-title,is-referenced-by-count,type,URL,update-to");
        const payload = await http.getJson(url, { signal: input.signal });
        for (const item of Array.isArray(payload?.message?.items) ? payload.message.items : []) {
          const source = sourceFromWork(item);
          if (source) sources.push(source);
        }
      }
      return sources;
    }
  };
}

function sourceFromWork(item) {
  const doi = clean(item?.DOI, 300);
  const url = doi ? `https://doi.org/${doi}` : item?.URL;
  const authors = (item?.author || []).map((author) => clean([author?.given, author?.family].filter(Boolean).join(" "), 120)).filter(Boolean).slice(0, 8).join("、");
  const container = clean(item?.["container-title"]?.[0], 300);
  const date = dateParts(item?.published?.["date-parts"]?.[0]);
  const updates = Array.isArray(item?.["update-to"]) ? item["update-to"].length : 0;
  return researchSource({
    title: item?.title?.[0] || doi || "Crossref scholarly work",
    url,
    publishedAt: date,
    provider: "Crossref",
    snippet: [
      doi ? `DOI ${doi}` : "",
      authors ? `作者 ${authors}` : "",
      container ? `来源 ${container}` : "",
      item?.type ? `类型 ${item.type}` : "",
      Number.isFinite(item?.["is-referenced-by-count"]) ? `Crossref 被引 ${item["is-referenced-by-count"]}` : "",
      updates ? `存在 ${updates} 条更新/更正关系` : ""
    ].filter(Boolean).join("；")
  });
}

function dateParts(parts) {
  if (!Array.isArray(parts) || !parts.length) return "";
  return parts.map((value, index) => String(value).padStart(index ? 2 : 4, "0")).join("-");
}
