import test from "node:test";
import assert from "node:assert/strict";
import { ensureReferenceTargets } from "../src/domain/report-reference-service.js";
import { resolveReportCitations } from "../src/domain/report-citation-service.js";

const source = { id: "source_19", title: "WIRED", url: "https://www.wired.com/story/example/" };

test("title and placeholder citations become numbered anchors even when an article fragment differs", () => {
  const sources = [{ id: "source_1", title: "真实来源标题", url: "https://www.pingwest.com/a/316735#1" }];
  const original = "正文 [来源标题](https://www.pingwest.com/a/316735) 和 [很长的新闻标题](#source_1)。\n\n## 参考来源\n1. [真实来源标题](https://www.pingwest.com/a/316735)";
  const { report } = resolveReportCitations(original, { sources });
  const body = report.split("## 参考来源")[0];
  assert.equal(body.match(/\[来源 1\]\(#source_1\)/g).length, 2);
  assert.doesNotMatch(body, /来源标题|很长的新闻标题|https:/);
  assert.equal(report.split('id="source_1"').length - 1, 1);
  assert.equal(report.split("https://www.pingwest.com/").length - 1, 1);
  assert.match(report, /\[真实来源标题\]\(https:/);
  assert.equal(resolveReportCitations(report, { sources }).report, report);
});

test("unknown URLs get distinct display references marked as unverified, not matched by title", () => {
  const original = "[WIRED](https://www.wired.com/story/another/)";
  const options = { sources: [source] };
  const result = resolveReportCitations(original, options);
  assert.match(result.report, /^\[来源 1\]\(#source_20\)/);
  assert.doesNotMatch(result.report, /#source_19/);
  assert.match(result.report, /未进入证据表，待核验/);
  assert.match(result.report, /\[WIRED\]\(https:\/\/www.wired.com\/story\/another\/\)/);
  assert.deepEqual(result.unresolvedIds, ["source_20"]);
  assert.deepEqual(resolveReportCitations(result.report, options), result);
});

test("unverified reference warnings also survive when the original reference entry exists", () => {
  const options = { sources: [source] };
  const original = "[来源标题](https://unknown.example/)\n\n## 参考来源\n1. [外部网页](https://unknown.example/)";
  const result = resolveReportCitations(original, options);
  assert.equal(result.report.split("https://unknown.example/").length - 1, 1);
  assert.match(result.report, /未进入证据表/);
  assert.deepEqual(resolveReportCitations(result.report, options), result);
});

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
  assert.match(report, /^正文 \[来源 1\]\(#source_19\)/);
  assert.match(report, /<a id="source_19"><\/a> \*\*来源 1\*\*：\[WIRED\]\(https:/);
  assert.equal(resolveReportCitations(report, options).report, report);
});

test("missing reference entries are added to References before the following section", () => {
  const report = ensureReferenceTargets("## References\nOriginal notes\n\n## Appendix\nKeep", new Map([[source.id, source]]), { outputLanguage: "en" });
  assert.match(report, /\*\*Source 19\*\*/);
  assert.ok(report.indexOf('id="source_19"') < report.indexOf("## Appendix"));
  assert.match(report, /Original notes/);
});
