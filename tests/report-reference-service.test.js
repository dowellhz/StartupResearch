import test from "node:test";
import assert from "node:assert/strict";
import { ensureReferenceTargets } from "../src/domain/report-reference-service.js";
import { resolveReportCitations } from "../src/domain/report-citation-service.js";

const source = { id: "source_19", title: "WIRED", url: "https://www.wired.com/story/example/" };

test("anchors existing reference entries without duplicating or losing their descriptions", () => {
  const original = `# Report\n\n## 参考来源\n\n1. [WIRED](${source.url}) — 原有说明\n\n## 附录\n附录保留`;
  const references = new Map([[source.id, source]]);
  const report = ensureReferenceTargets(original, references);
  assert.match(report, /1\. <a id="source_19"><\/a> \[WIRED\]/);
  assert.equal(report.split(source.url).length - 1, 1);
  assert.match(report, /原有说明/);
  assert.match(report, /## 附录\n附录保留/);
  assert.equal(ensureReferenceTargets(report, references), report);
});

test("migrates previous direct citations to internal links and retains external reference links", () => {
  const original = `正文 [来源 19](${source.url})。\n\n## 参考来源\n- [WIRED](${source.url})`;
  const options = { sources: [source] };
  const { report } = resolveReportCitations(original, options);
  assert.match(report, /^正文 \[来源 19\]\(#source_19\)/);
  assert.match(report, /<a id="source_19"><\/a> \[WIRED\]\(https:/);
  assert.equal(resolveReportCitations(report, options).report, report);
});

test("missing reference entries are added to References before the following section", () => {
  const report = ensureReferenceTargets("## References\nOriginal notes\n\n## Appendix\nKeep", new Map([[source.id, source]]), { outputLanguage: "en" });
  assert.match(report, /\*\*Source 19\*\*/);
  assert.ok(report.indexOf('id="source_19"') < report.indexOf("## Appendix"));
  assert.match(report, /Original notes/);
});
