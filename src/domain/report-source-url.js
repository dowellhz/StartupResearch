export function citationUrl(value) {
  const text = String(value || "").trim();
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    return url.href.replace(/[()']/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch { return ""; }
}

// Fragment identifiers locate a part of an article, not another document.
// Hash-router URLs are different pages and must retain their route.
export function citationDocumentUrl(value) {
  const canonical = citationUrl(value);
  if (!canonical) return "";
  const url = new URL(canonical);
  if (!/^#(?:!|\/)/.test(url.hash)) url.hash = "";
  return url.href;
}
