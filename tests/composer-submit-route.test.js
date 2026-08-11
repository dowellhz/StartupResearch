import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACHMENT_SUBMISSION,
  COMPANY_RESEARCH_SUBMISSION,
  CONFIRM_COMPANY_RESEARCH_SUBMISSION,
  decideComposerSubmission,
  FOLLOWUP_SUBMISSION,
  INDUSTRY_RESEARCH_SUBMISSION,
  PAPER_ANALYSIS_SUBMISSION,
  TECHNOLOGY_RESEARCH_SUBMISSION
} from "../public/composer-submit-route.js";

test("an attachment keeps the existing BP review flow without confirmation", () => {
  const result = decideComposerSubmission({
    taskType: "attachment_review",
    hasFile: true
  });
  assert.equal(result, ATTACHMENT_SUBMISSION);
});

test("industry, technology and paper modes submit their explicit research task types", () => {
  assert.equal(decideComposerSubmission({ taskType: "industry_research" }), INDUSTRY_RESEARCH_SUBMISSION);
  assert.equal(decideComposerSubmission({ taskType: "technology_research" }), TECHNOLOGY_RESEARCH_SUBMISSION);
  assert.equal(decideComposerSubmission({ taskType: "paper_analysis" }), PAPER_ANALYSIS_SUBMISSION);
});

test("a completed conversation without a new file remains a follow-up", () => {
  const result = decideComposerSubmission({
    taskType: "attachment_review",
    hasCurrentReport: true,
    hasFile: false
  });
  assert.equal(result, FOLLOWUP_SUBMISSION);
});

test("no attachment routes through the in-page company research confirmation", () => {
  const result = decideComposerSubmission({
    taskType: "attachment_review",
    hasFile: false
  });
  assert.equal(result, CONFIRM_COMPANY_RESEARCH_SUBMISSION);
});

test("explicit company research mode submits without another confirmation", () => {
  const result = decideComposerSubmission({
    taskType: "company_pre_research",
    hasFile: false
  });
  assert.equal(result, COMPANY_RESEARCH_SUBMISSION);
});
