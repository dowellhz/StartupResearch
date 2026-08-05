import { boundedQueries, clean, firstValue, researchSource } from "./research-tool-source.js";

export function createProcurementNoticeSearchTool({ http, maxQueries = 2, maxResults = 4 } = {}) {
  if (!http) throw new Error("TED HTTP dependency is required");
  return {
    name: "procurement_notice_search",
    async search(input = {}) {
      const sources = [];
      for (const query of boundedQueries({ ...input, maxQueries })) {
        const payload = await http.postJson("https://api.ted.europa.eu/v3/notices/search", {
          query: `FT ~ \"${escapeExpertQuery(query)}\"`,
          fields: ["publication-number", "notice-title", "publication-date", "buyer-name", "winner-name", "form-type"],
          page: 1,
          limit: maxResults,
          scope: "ALL",
          checkQuerySyntax: false,
          paginationMode: "PAGE_NUMBER"
        }, { signal: input.signal });
        const notices = payload?.notices || payload?.results || payload?.data || [];
        for (const notice of Array.isArray(notices) ? notices : []) {
          const source = sourceFromNotice(notice);
          if (source) sources.push(source);
        }
      }
      return sources;
    }
  };
}

function sourceFromNotice(notice) {
  const publicationNumber = firstValue(notice?.["publication-number"] || notice?.publicationNumber || notice?.publication_number);
  const link = firstValue(notice?.links?.html || notice?.links?.HTML || notice?.url)
    || (publicationNumber ? `https://ted.europa.eu/en/notice/-/detail/${encodeURIComponent(publicationNumber)}` : "");
  if (!link) return null;
  const buyer = firstValue(notice?.["buyer-name"] || notice?.buyerName);
  const winner = firstValue(notice?.["winner-name"] || notice?.winnerName);
  return researchSource({
    title: firstValue(notice?.["notice-title"] || notice?.noticeTitle) || publicationNumber || "TED procurement notice",
    url: link,
    publishedAt: firstValue(notice?.["publication-date"] || notice?.publicationDate),
    provider: "TED",
    snippet: [
      publicationNumber ? `公告号 ${publicationNumber}` : "",
      buyer ? `采购方 ${buyer}` : "",
      winner ? `中标方 ${winner}` : "",
      firstValue(notice?.["form-type"] || notice?.formType) ? `公告类型 ${firstValue(notice?.["form-type"] || notice?.formType)}` : ""
    ].filter(Boolean).join("；")
  });
}

function escapeExpertQuery(value) {
  return clean(value, 220).replace(/["\\]/g, " ");
}
