import { escapeHtml } from "./markdown-renderer.js";

const DEFAULT_SUGGESTIONS = [
  "核心能力｜公司的核心能力或核心技术是什么，哪些真正形成差异化壁垒？",
  "技术验证｜相关技术优势需要哪些性能指标、基准测试和第三方证据？",
  "行业研究｜所在行业的竞争格局、增长驱动和未来三年趋势是什么？",
  "尽调建议｜下一轮尽调应该向公司索取哪些材料？"
];

export function renderFollowupSuggestions(container, suggestions, onSelect) {
  const provided = Array.isArray(suggestions) && suggestions.length ? suggestions : DEFAULT_SUGGESTIONS;
  const values = Array.from(new Set(provided
    .map((value) => String(value || "").trim())
    .filter(Boolean))).slice(0, 4);
  container.classList.toggle("hidden", !values.length);
  if (!values.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `
    <strong>你可以继续问</strong>
    <div>${values.map((question) => suggestionButton(question)).join("")}</div>`;
  container.querySelectorAll("[data-followup-suggestion]").forEach((button) => {
    button.addEventListener("click", () => onSelect(button.dataset.followupSuggestion));
  });
}

function suggestionButton(question) {
  const [category, ...content] = question.split("｜");
  const hasCategory = Boolean(content.length);
  const visibleQuestion = hasCategory ? content.join("｜") : category;
  return `<button type="button" data-followup-suggestion="${escapeHtml(question)}" aria-label="发起追问：${escapeHtml(question)}">${hasCategory ? `<span>${escapeHtml(category)}</span>` : ""}${escapeHtml(visibleQuestion)}</button>`;
}
