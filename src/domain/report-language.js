export const OUTPUT_ZH = "zh";
export const OUTPUT_EN = "en";

export function normalizeOutputLanguage(value) {
  return String(value || "").toLowerCase().startsWith("en") ? OUTPUT_EN : OUTPUT_ZH;
}

export function isEnglishOutput(value) {
  return normalizeOutputLanguage(value) === OUTPUT_EN;
}

export function reportLanguageInstruction(value, { structured = false } = {}) {
  if (isEnglishOutput(value)) {
    return structured
      ? "Write every user-facing natural-language field in English. Preserve proper nouns and source titles in their original language when needed."
      : "Write the entire report in English, including its title, headings, table headers, labels, conclusions, caveats, and recommendations. Preserve proper nouns and source titles in their original language when needed.";
  }
  return structured ? "所有面向用户的自然语言字段使用简体中文。" : "报告标题、正文、栏目、表头、结论、限制和建议全部使用简体中文。";
}
