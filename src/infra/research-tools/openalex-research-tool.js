import { boundedQueries, clean, researchSource } from "./research-tool-source.js";

export function createOpenAlexResearchTool({ http, apiKey, maxQueries = 2, maxResults = 4 } = {}) {
  if (!http) throw new Error("OpenAlex HTTP dependency is required");
  if (!apiKey) throw new Error("OpenAlex API key is required");
  return {
    name: "openalex_research_search",
    requiresKey: true,
    async search(input = {}) {
      const sources = [];
      for (const query of boundedQueries({ ...input, maxQueries })) {
        const url = new URL("https://api.openalex.org/works");
        url.searchParams.set("search", query);
        url.searchParams.set("per-page", String(maxResults));
        url.searchParams.set("select", "id,doi,display_name,publication_date,authorships,primary_location,cited_by_count,type,updated_date");
        url.searchParams.set("api_key", apiKey);
        const payload = await http.getJson(url, { signal: input.signal });
        for (const work of Array.isArray(payload?.results) ? payload.results : []) {
          const source = sourceFromWork(work);
          if (source) sources.push(source);
        }
      }
      return sources;
    }
  };
}

function sourceFromWork(work) {
  const authors = (work?.authorships || []).map((item) => clean(item?.author?.display_name, 120)).filter(Boolean).slice(0, 8);
  const institutions = Array.from(new Set((work?.authorships || []).flatMap((item) => item?.institutions || [])
    .map((item) => clean(item?.display_name, 160)).filter(Boolean))).slice(0, 6);
  const doi = clean(work?.doi, 300);
  const url = doi || work?.primary_location?.landing_page_url || work?.id;
  return researchSource({
    title: work?.display_name || work?.id || "OpenAlex scholarly work",
    url,
    publishedAt: work?.publication_date || work?.updated_date || "",
    sourceTier: "secondary",
    provider: "OpenAlex",
    snippet: [
      authors.length ? `作者 ${authors.join("、")}` : "",
      institutions.length ? `机构 ${institutions.join("、")}` : "",
      work?.primary_location?.source?.display_name ? `来源 ${work.primary_location.source.display_name}` : "",
      work?.type ? `类型 ${work.type}` : "",
      Number.isFinite(work?.cited_by_count) ? `OpenAlex 被引 ${work.cited_by_count}` : "",
      doi ? `DOI ${doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")}` : ""
    ].filter(Boolean).join("；")
  });
}
