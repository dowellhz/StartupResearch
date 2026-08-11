const TEXT_FIELDS = ["question", "text", "description", "statement", "gap", "issue", "title", "nextStep"];

export function normalizeResearchQuestion(value) {
  if (typeof value === "string" || typeof value === "number") return clean(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  for (const field of TEXT_FIELDS) {
    const text = clean(value[field]);
    if (text) return text;
  }
  return "";
}

export function normalizeResearchQuestions(values, limit = 30) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map(normalizeResearchQuestion)
    .filter(Boolean)))
    .slice(0, limit);
}

function clean(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text === "[object Object]" ? "" : text.slice(0, 600);
}
