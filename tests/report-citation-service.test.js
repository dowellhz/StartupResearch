import test from "node:test";
import assert from "node:assert/strict";
import { citationFindings, resolveReportCitations } from "../src/domain/report-citation-service.js";
import { normalizeReviewReport } from "../src/domain/report-summary-service.js";
import { stabilizeIndustryResearchReport, assessIndustryResearchQuality } from "../src/domain/industry-research-quality.js";
import { stabilizeCompanyResearchReport, assessCompanyResearchQuality } from "../src/domain/company-pre-research-quality.js";
import { stabilizePaperAnalysisReport, assessPaperAnalysisQuality } from "../src/domain/paper-analysis-quality.js";
import { stabilizeReport, assessReportQuality } from "../src/domain/report-quality-service.js";
import { markdownToHtml } from "../public/markdown-renderer.js";

const sources = [
  { id: "source_19", title: "WIRED", url: "https://www.wired.com/story/example/?a=1&b=2" },
  { id: "source_3", title: "Yahoo Tech", url: "https://tech.yahoo.com/article.html#1" }
];

test("resolves actual evidence IDs in prose, lists and tables into clickable links", () => {
  const markdown = "WIRED为16亿元（source_19），Yahoo为2.26亿美元（source_3）。\n- 来源：source_19、[source_3]\n| 指标 | source_19 |";
  const result = resolveReportCitations(markdown, { sources });
  assert.deepEqual(result.unresolvedIds, []);
  assert.match(result.report, /\[来源 19\]\(https:\/\/www.wired.com/);
  assert.match(result.report, /\[来源 3\]\(https:\/\/tech.yahoo.com/);
  assert.doesNotMatch(result.report, /source_\d/);
  assert.match(markdownToHtml(result.report), /href="https:\/\/www.wired.com\/story\/example\/\?a=1&amp;b=2"/);
  assert.equal(resolveReportCitations(result.report, { sources }).report, result.report);
});

test("does not rewrite existing links, URLs, code or partial identifiers", () => {
  const markdown = '[source_19](https://example.com/source_3) https://example.com/source_19\n`source_19`\n```js\nsource_3\n```\n~~~\nsource_19\n~~~\nfoo_source_19 source_19abc\n[source_19][existing]\n[link]: https://example.com/source_19';
  assert.equal(resolveReportCitations(markdown, { sources }).report, markdown);
});

test("unknown, unsafe and ambiguous references are marked without invented links", () => {
  const options = { sources: [
    ...sources,
    { id: "source_19", url: "https://different.example/" },
    { id: "source_4", url: "javascript:alert(1)" },
    { id: "source_5", url: "https://user:secret@example.com" }
  ] };
  const result = resolveReportCitations("source_19 source_99 source_4 source_5", options);
  assert.deepEqual(result.unresolvedIds, ["source_19", "source_99", "source_4", "source_5"]);
  assert.doesNotMatch(result.report, /\]\(/);
  assert.match(result.report, /source_99（来源未匹配）/);
  assert.equal(resolveReportCitations(result.report, options).report, result.report);
  assert.equal(citationFindings(result.report, options)[0].code, "citation_source_unresolved");
});

test("legacy reports resolve citations in every task type and both languages", () => {
  for (const taskType of ["attachment_review", "company_pre_research", "industry_research", "paper_analysis"]) {
    for (const outputLanguage of ["zh", "en"]) {
      const report = normalizeReviewReport({ taskType, outputLanguage, sources }, "Existing report source_19");
      assert.match(report, /\]\(https:\/\/www.wired.com/);
      assert.match(report, outputLanguage === "en" ? /\[Source 19\]/ : /\[来源 19\]/);
    }
  }
});

test("all report quality gates resolve known citations and flag unmatched references", () => {
  for (const [stabilize, assess] of [
    [stabilizeIndustryResearchReport, assessIndustryResearchQuality],
    [stabilizeCompanyResearchReport, assessCompanyResearchQuality],
    [stabilizePaperAnalysisReport, assessPaperAnalysisQuality],
    [stabilizeReport, assessReportQuality]
  ]) {
    const options = { sources, outputLanguage: "zh" };
    const report = stabilize("# Report\n\nEvidence source_19, unknown source_99", options);
    assert.match(report, /\[来源 19\]/);
    assert.match(report, /source_99（来源未匹配）/);
    const quality = assess(report, options);
    assert.equal(quality.ok, false);
    assert.ok(quality.findings.some((finding) => finding.code === "citation_source_unresolved"));
    assert.ok(!quality.findings.some((finding) => finding.code === "citation_provenance_invalid"));
  }
});
