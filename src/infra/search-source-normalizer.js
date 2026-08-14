export function normalizeSearchSources(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const sources = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== "object") return;
    const url = String(value.url || value.source_url || value.link || "").trim();
    if (url) {
      sources.push({
        title: String(value.title || value.name || url).trim(),
        url,
        snippet: evidenceText(value),
        supports: normalizeClaimLinks(value.supports),
        conflicts: normalizeClaimLinks(value.conflicts),
        publishedAt: String(value.publishedAt || value.page_age || value.pageAge || value.date || "").slice(0, 100)
      });
    }
    for (const key of ["content", "results", "citations", "sources", "data"]) visit(value[key]);
  };
  visit(blocks);
  const textBlocks = blocks.map((block) => typeof block?.text === "string" ? block.text : "").filter(Boolean);
  for (const textBlock of textBlocks) {
    const parsed = parseSearchJson(textBlock);
    if (parsed) visit(parsed);
  }
  const text = textBlocks.join("\n");
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>，。)）\]]+/g)) {
    sources.push({ title: match[0], url: match[0], snippet: "", supports: [], conflicts: [], publishedAt: "" });
  }
  return uniqueSources(sources, 16);
}

export function uniqueSources(sources, limit = 24) {
  const unique = new Map();
  for (const source of sources) {
    if (!source?.url) continue;
    const existing = unique.get(source.url);
    unique.set(source.url, existing ? mergeSearchSource(existing, source) : source);
  }
  return Array.from(unique.values()).slice(0, limit);
}

function evidenceText(value) {
  const direct = [value.snippet, value.summary, value.cited_text, value.citedText, value.excerpt]
    .find((item) => typeof item === "string" && item.trim());
  if (direct) return direct.trim().slice(0, 1600);
  if (typeof value.text === "string" && !/^https?:\/\//.test(value.text.trim())) return value.text.trim().slice(0, 1600);
  return "";
}

function normalizeClaimLinks(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 30);
  return Array.from(new Set(String(value || "").match(/(?:claim|c)[_-]?\d+/gi) || [])).slice(0, 30);
}

function parseSearchJson(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) || parsed?.results || parsed?.sources ? parsed : null;
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}

function mergeSearchSource(left, right) {
  return {
    ...left,
    title: right.title && !/^https?:\/\//.test(right.title) ? right.title : left.title,
    snippet: right.snippet?.length > left.snippet?.length ? right.snippet : left.snippet,
    supports: Array.from(new Set([...(left.supports || []), ...(right.supports || [])])),
    conflicts: Array.from(new Set([...(left.conflicts || []), ...(right.conflicts || [])])),
    publishedAt: left.publishedAt || right.publishedAt || "",
    provider: left.provider || right.provider || ""
  };
}
