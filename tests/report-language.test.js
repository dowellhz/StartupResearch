import test from "node:test";
import assert from "node:assert/strict";
import { buildReportMessages, REPORT_SECTIONS_EN } from "../src/domain/review-prompts.js";
import { stabilizeReport } from "../src/domain/report-quality-service.js";
import { buildCompanyResearchReportMessages, COMPANY_RESEARCH_SECTIONS_EN } from "../src/domain/company-pre-research-prompts.js";
import { stabilizeCompanyResearchReport } from "../src/domain/company-pre-research-quality.js";
import { buildIndustryReportMessages } from "../src/domain/industry-research-prompts.js";
import { stabilizeIndustryResearchReport } from "../src/domain/industry-research-quality.js";
import { buildPaperReportMessages, PAPER_ANALYSIS_SECTIONS_EN } from "../src/domain/paper-analysis-prompts.js";
import { stabilizePaperAnalysisReport } from "../src/domain/paper-analysis-quality.js";
import { normalizeReviewReport } from "../src/domain/report-summary-service.js";

test("English output language is an explicit hard requirement in every report prompt", () => {
  const bp = buildReportMessages({ outputLanguage: "en", document: {}, sources: [] });
  const company = buildCompanyResearchReportMessages({ outputLanguage: "en", sources: [] });
  const industry = buildIndustryReportMessages({ outputLanguage: "en", researchTemplate: "investment", sources: [] });
  const paper = buildPaperReportMessages({ outputLanguage: "en", document: {}, sources: [] });
  for (const messages of [bp, company, industry, paper]) {
    assert.match(messages[0].content, /entire report in English/i);
  }
  assert.match(bp[0].content, /## Review Conclusion Summary/);
  assert.match(company[0].content, /## Research Conclusion Summary/);
  assert.match(industry[0].content, /## Investment Conclusion/);
  assert.match(paper[0].content, /### Technical Problem/);
});

test("loading an English report never injects a Chinese summary", () => {
  const report = "# Acme BP Review\n\n## Review Conclusion Summary\n\nProceed conditionally.\n\n## References\n\nNone.";
  assert.equal(normalizeReviewReport({ outputLanguage: "en", taskType: "attachment_review" }, report), report);
});

test("English quality stabilizers add only English required sections", () => {
  const bp = stabilizeReport("# Acme BP Review", { companyName: "Acme", outputLanguage: "en", sourceCount: 0 });
  const company = stabilizeCompanyResearchReport("# Acme Company Research", { companyName: "Acme", outputLanguage: "en", sourceCount: 0 });
  const industry = stabilizeIndustryResearchReport("# Robotics", { topic: "Robotics", outputLanguage: "en", researchTemplate: "investment" });
  const paper = stabilizePaperAnalysisReport("# Example Paper", { title: "Example Paper", outputLanguage: "en" });

  for (const section of REPORT_SECTIONS_EN) assert.match(bp, new RegExp(`## ${escapePattern(section)}`));
  for (const section of COMPANY_RESEARCH_SECTIONS_EN) assert.match(company, new RegExp(`## ${escapePattern(section)}`));
  assert.match(industry, /## Research Conclusion Summary/);
  assert.match(industry, /## References/);
  for (const section of PAPER_ANALYSIS_SECTIONS_EN) assert.match(paper, new RegExp(`## ${escapePattern(section)}`));
  for (const report of [bp, company, industry, paper]) assert.doesNotMatch(report, /## (核查结论摘要|预研结论摘要|研究结论摘要|这篇论文讲了什么|参考来源)/);
});

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
