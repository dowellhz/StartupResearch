export function shouldUseWebSearch(question) {
  return /https?:\/\/|google\s*scholar|谷歌学术|检索|搜索|联网|公开资料|最新|引用量|clinicaltrials|\bNCT\d{8}\b|临床试验|药物管线|适应症/i.test(String(question || ""));
}

export function buildWebSearchQueries(question) {
  const text = String(question || "").trim();
  const urls = text.match(/https?:\/\/[^\s<>"'，。]+/g) || [];
  return Array.from(new Set([...urls.slice(0, 2), text])).slice(0, 3);
}
