import { ensureReferenceTargets } from "./report-reference-service.js";

// Citation IDs are identifiers, not semantic claims: resolve them only against
// the report's own evidence table, never by array position or a guessed URL.
export function resolveReportCitations(markdown, { sources = [], outputLanguage } = {}) {
  const urls = new Map();
  for (const source of sources || []) {
    if (!/^source_\d+$/.test(source?.id || "")) continue;
    const url = citationUrl(source.url);
    urls.set(source.id, urls.has(source.id) && urls.get(source.id) !== url ? "" : url);
  }
  const unresolved = new Set();
  const references = new Map();
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const english = outputLanguage === "en";
  const marker = english ? " (source unavailable)" : "（来源未匹配）";
  let fence = null;
  let inReferences = false;
  const link = (id, label) => {
    references.set(id, { ...sourceById.get(id), url: urls.get(id) });
    return `[${label || `${english ? "Source" : "来源"} ${id.slice(7)}`}](#${id})`;
  };
  const report = String(markdown || "").split("\n").map((line) => {
    const edge = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (edge && edge[1][0] === fence[0] && edge[1].length >= fence.length && !edge[2].trim()) fence = null;
      return line;
    }
    if (edge) { fence = edge[1]; return line; }
    if (/^##\s/.test(line)) inReferences = /^##\s+(?:参考来源|参考资料|References)\s*$/i.test(line);
    if (inReferences) return line;
    // Preserve existing links, inline code and URLs verbatim. Bare [source_N]
    // citations are handled as a unit so conversion cannot create nested links.
    return line.replace(/<a id="source_\d+"><\/a>|!?\[[^\]\n]*\]\((?:\\.|[^)\\\n])*\)|!?\[[^\]\n]*\]\[[^\]\n]*\]|`+[^`]*`+|https?:\/\/[^\s<>]+|\[[^\]\n]+\]:\s*\S+|(?<![\w/])(?:\[(source_\d+)\]|(source_\d+))(?!\w)/g,
      (token, bracketed, bare, offset) => {
        const existing = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (existing) {
          const fragmentId = existing[2].match(/^#(source_\d+)$/)?.[1];
          if (fragmentId && urls.get(fragmentId)) return link(fragmentId, existing[1]);
          const namedId = existing[1].match(/^(?:来源 |Source |source_)(\d+)$/)?.[1];
          const url = citationUrl(existing[2]);
          const matches = [...urls].filter(([, value]) => value && value === url);
          const id = namedId && urls.get(`source_${namedId}`) === url ? `source_${namedId}` : matches.length === 1 ? matches[0][0] : "";
          if (id) return link(id, existing[1]);
        }
        const id = bracketed || bare;
        if (!id) return token;
        const url = urls.get(id);
        if (url) return link(id);
        unresolved.add(id);
        const alreadyMarked = /^(?:（来源未匹配）| \(source unavailable\))/.test(line.slice(offset + token.length));
        return token + (alreadyMarked ? "" : marker);
      });
  }).join("\n");
  return { report: ensureReferenceTargets(report, references, { outputLanguage }), unresolvedIds: [...unresolved] };
}

export function citationFindings(markdown, options = {}) {
  const { unresolvedIds } = resolveReportCitations(markdown, options);
  return unresolvedIds.length ? [{
    code: "citation_source_unresolved",
    severity: "fatal",
    message: options.outputLanguage === "en"
      ? `Citations could not be matched to a unique source URL: ${unresolvedIds.join(", ")}`
      : `引用无法匹配到唯一来源网址：${unresolvedIds.join("、")}`
  }] : [];
}

export function citationUrl(value) {
  const text = String(value || "").trim();
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    return url.href.replace(/[()']/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch { return ""; }
}
