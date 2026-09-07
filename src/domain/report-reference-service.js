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
    if (entries.some((line) => line.includes(anchor))) continue;
    const index = entries.findIndex((line) => line.includes(`](${source.url})`));
    if (index >= 0) {
      entries[index] = entries[index].replace(/^(\s*(?:[-*+]|\d+[.)])\s+)?/, (prefix) => `${prefix}${anchor} `);
    } else {
      const label = `${outputLanguage === "en" ? "Source" : "来源"} ${id.slice(7)}`;
      const title = String(source.title || source.url).replace(/[\r\n]+/g, " ").replaceAll("[", "［").replaceAll("]", "］");
      entries.push(`- ${anchor} **${label}**：[${title}](${source.url})`);
    }
  }
  return [...lines.slice(0, start + 1), ...entries, ...lines.slice(end)].join("\n");
}
