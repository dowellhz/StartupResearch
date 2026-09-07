import { citationDocumentUrl } from "./report-source-url.js";

export function ensureReferenceTargets(markdown, references, { outputLanguage } = {}) {
  if (!references.size) return markdown;
  const lines = markdown.split("\n");
  let start = lines.findIndex((line) => /^##\s+(?:参考来源|参考资料|References)\s*$/i.test(line));
  if (start < 0) {
    lines.push("", `## ${outputLanguage === "en" ? "References" : "参考来源"}`, "");
    start = lines.length - 2;
  }
  let end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  if (end < 0) end = lines.length;
  const entries = lines.slice(start + 1, end);
  for (const [id, source] of references) {
    const anchor = `<a id="${id}"></a>`;
    const warning = source.unverified ? outputLanguage === "en" ? " (not in the evidence table; verification required)" : "（未进入证据表，待核验）" : "";
    if (entries.some((line) => line.includes(anchor))) continue;
    const index = entries.findIndex((line) => [...line.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)]
      .some((match) => citationDocumentUrl(match[1]) === citationDocumentUrl(source.url)));
    if (index >= 0) {
      entries[index] = entries[index].replace(/^(\s*(?:[-*+]|\d+[.)])\s+)?/, (prefix) => `${prefix}${anchor} `);
      if (warning && !entries[index].includes(warning)) entries[index] += warning;
    } else {
      const label = `${outputLanguage === "en" ? "Source" : "来源"} ${id.slice(7)}`;
      const title = String(source.title || source.url).replace(/[\r\n]+/g, " ").replaceAll("[", "［").replaceAll("]", "］");
      entries.push(`- ${anchor} **${label}**：[${title}](${source.url})${warning}`);
    }
  }
  return [...lines.slice(0, start + 1), ...entries, ...lines.slice(end)].join("\n");
}

// Display-only references preserve model-supplied URLs without silently adding
// them to the evidence table. Their IDs and warning survive repeated reads.
export function createUnverifiedReferenceIndex(markdown, sources = []) {
  const byId = new Map();
  let next = Math.max(0, ...sources.map((source) => Number(String(source.id).match(/^source_(\d+)$/)?.[1]) || 0));
  for (const match of String(markdown).matchAll(/source_(\d+)/g)) next = Math.max(next, Number(match[1]));
  for (const line of String(markdown).split("\n")) {
    const id = line.match(/<a id="(source_\d+)"><\/a>/)?.[1];
    if (id) next = Math.max(next, Number(id.slice(7)));
    if (!id || !/未进入证据表|not in the evidence table/.test(line)) continue;
    const link = line.match(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/);
    if (link) byId.set(id, { id, title: link[1], url: link[2], unverified: true });
  }
  return {
    byId,
    get(url, title) {
      const existing = [...byId.values()].find((source) => citationDocumentUrl(source.url) === citationDocumentUrl(url));
      if (existing) return existing;
      const source = { id: `source_${++next}`, title, url, unverified: true };
      byId.set(source.id, source);
      return source;
    }
  };
}
