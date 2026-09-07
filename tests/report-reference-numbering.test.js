import test from "node:test";
import assert from "node:assert/strict";
import { numberReportReferences } from "../src/domain/report-reference-numbering.js";
import { resolveReportCitations } from "../src/domain/report-citation-service.js";
import { markdownToHtml } from "../public/markdown-renderer.js";

test("display numbers follow bibliography order, not sparse evidence IDs or first citation order", () => {
  const sources = [1, 30, 40].map((n) => ({ id: `source_${n}`, title: `Article ${n}`, url: `https://example.com/${n}` }));
  const original = "正文 source_40、source_30、source_1，再引 source_30。\n\n## 参考来源\n1. [First](https://example.com/1)\n2. [Second](https://example.com/30)\n3. [Third](https://example.com/40)";
  const result = resolveReportCitations(original, { sources });
  assert.match(result.report, /^正文 \[来源 3\]\(#source_40\)、\[来源 2\]\(#source_30\)、\[来源 1\]\(#source_1\)/);
  const html = markdownToHtml(result.report);
  for (const [index, id] of [1, 30, 40].entries()) {
    assert.ok(html.includes(`href="#source_${id}">来源 ${index + 1}</a>`));
    assert.ok(html.includes(`id="source_${id}"></span> <strong>来源 ${index + 1}</strong>`));
  }
  assert.equal(resolveReportCitations(result.report, { sources }).report, result.report);
});

test("uncited entries still count, and duplicate source aliases share the same row number", () => {
  const markdown = '[Source 40](#source_40) [Source 41](#source_41)\n\n## References\n1. [Uncited](https://example.com/1)\n2. <a id="source_40"></a> <a id="source_41"></a> [Same article](https://example.com/2)';
  const result = numberReportReferences(markdown, { outputLanguage: "en" });
  assert.match(result, /^\[Source 2\]\(#source_40\) \[Source 2\]\(#source_41\)/);
  assert.equal(numberReportReferences(result, { outputLanguage: "en" }), result);
});

test("numbering preserves code, descriptions and sections following References", () => {
  const input = '```\n## References\n1. [Example](https://example.com/code)\n```\n\n## 参考来源\n7. <a id="source_19"></a> [Title](https://example.com/) — 原有说明\n\n## 附录\n`[来源 19](#source_19)`';
  const result = numberReportReferences(input);
  assert.match(result, /```\n## References\n1\. \[Example\]/);
  assert.match(result, /\*\*来源 1\*\*：\[Title\].*原有说明/);
  assert.match(result, /## 附录\n`\[来源 19\]\(#source_19\)`/);
});
