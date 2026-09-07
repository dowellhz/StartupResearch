// Evidence IDs stay stable. Display numbers belong to the bibliography order,
// which can be a filtered/reordered subset of the evidence table.
export function numberReportReferences(markdown, { outputLanguage } = {}) {
  const numbers = new Map();
  const label = outputLanguage === "en" ? "Source" : "来源";
  let ordinal = 0;
  const lines = mapProse(markdown, (line, inReferences) => {
    if (!inReferences || !/\]\(https?:\/\//.test(line)) return line;
    ordinal += 1;
    const anchors = [...line.matchAll(/<a id="(source_\d+)"><\/a>/g)];
    for (const anchor of anchors) numbers.set(anchor[1], ordinal);
    const content = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/<a id="source_\d+"><\/a>\s*/g, "")
      .replace(/^\*\*(?:来源|Source)\s+\d+\*\*[：:]\s*/, "").trim();
    return `- ${anchors.map((anchor) => anchor[0]).join(" ")}${anchors.length ? " " : ""}**${label} ${ordinal}**：${content}`;
  }).join("\n");
  return mapProse(lines, (line, inReferences) => inReferences ? line : line.replace(
    /`+[^`]*`+|\[[^\]\n]+\]\(#(source_\d+)\)/g,
    (token, id) => numbers.has(id) ? `[${label} ${numbers.get(id)}](#${id})` : token
  )).join("\n");
}

function mapProse(markdown, transform) {
  let fence = null;
  let inReferences = false;
  return String(markdown).split("\n").map((line) => {
    const edge = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (edge && edge[1][0] === fence[0] && edge[1].length >= fence.length && !edge[2].trim()) fence = null;
      return line;
    }
    if (edge) { fence = edge[1]; return line; }
    if (/^##\s/.test(line)) inReferences = /^##\s+(?:参考来源|参考资料|References)\s*$/i.test(line);
    return transform(line, inReferences);
  });
}
