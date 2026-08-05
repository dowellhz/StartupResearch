export function researchSource({ title, url, snippet, publishedAt = "", sourceTier = "primary", provider = "" } = {}) {
  const normalizedUrl = validHttpUrl(url);
  if (!normalizedUrl) return null;
  return {
    title: clean(title || normalizedUrl, 500),
    url: normalizedUrl,
    snippet: clean(snippet, 2000),
    supports: [],
    conflicts: [],
    publishedAt: clean(publishedAt, 100),
    sourceTier,
    provider: clean(provider, 100)
  };
}

export function boundedQueries({ companyName = "", queries = [], maxQueries = 2 } = {}) {
  const values = [companyName, ...(Array.isArray(queries) ? queries : [])]
    .map((value) => clean(value, 300))
    .filter((value) => value.length >= 2);
  return Array.from(new Set(values)).slice(0, maxQueries);
}

export function clean(value, maxLength = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function firstValue(value) {
  if (Array.isArray(value)) return firstValue(value[0]);
  if (value && typeof value === "object") return firstValue(Object.values(value)[0]);
  return clean(value);
}

function validHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}
