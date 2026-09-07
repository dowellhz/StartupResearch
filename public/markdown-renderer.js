export function markdownToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const output = [];
  let list = "";
  let table = [];
  let fence = null;
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
    const fenceEdge = line.match(/^`{3,}\s*([\w+#.-]*)\s*$/);
    if (fence) {
      // 围栏内保留原始缩进，且不做任何 Markdown 解析。
      if (fenceEdge) { output.push(renderFence(fence)); fence = null; }
      else fence.lines.push(raw);
      continue;
    }
    if (fenceEdge) { closeList(); flushTable(); fence = { language: fenceEdge[1], lines: [] }; continue; }
    if (/^\|.*\|$/.test(line)) { closeList(); table.push(line); continue; }
    flushTable();
    if (!line) { closeList(); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
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
  // 流式渲染时围栏可能尚未闭合，直接按代码块输出，好过把 ``` 当正文显示。
  if (fence) output.push(renderFence(fence));
  return output.join("");
}

function renderFence({ language, lines }) {
  const attribute = language ? ` class="language-${escapeHtml(language)}"` : "";
  return `<pre class="code-block"><code${attribute}>${escapeHtml(lines.join("\n"))}</code></pre>`;
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
