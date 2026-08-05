export function markdownToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const output = [];
  let list = "";
  let table = [];
  const closeList = () => { if (list) output.push(`</${list}>`); list = ""; };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((line) => !/^\|?\s*:?-{3,}/.test(line));
    const html = rows.map((line, index) => {
      const cells = line.replace(/^\||\|$/g, "").split("|").map((cell) => inlineMarkdown(cell.trim()));
      const tag = index === 0 ? "th" : "td";
      return `<tr>${cells.map((cell) => `<${tag}>${cell}</${tag}>`).join("")}</tr>`;
    }).join("");
    output.push(`<div class="table-wrap"><table>${html}</table></div>`);
    table = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\|.*\|$/.test(line)) { closeList(); table.push(line); continue; }
    flushTable();
    if (!line) { closeList(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { closeList(); output.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`); continue; }
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || ordered) {
      const type = bullet ? "ul" : "ol";
      if (list !== type) { closeList(); output.push(`<${type}>`); list = type; }
      output.push(`<li>${inlineMarkdown((bullet || ordered)[1])}</li>`);
      continue;
    }
    closeList();
    if (line.startsWith(">")) output.push(`<blockquote>${inlineMarkdown(line.slice(1).trim())}</blockquote>`);
    else output.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();
  flushTable();
  return output.join("");
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
