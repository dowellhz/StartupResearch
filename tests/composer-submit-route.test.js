import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACHMENT_SUBMISSION,
  CANCEL_SUBMISSION,
  COMPANY_RESEARCH_SUBMISSION,
  decideComposerSubmission,
  FOLLOWUP_SUBMISSION,
  NO_ATTACHMENT_CONFIRMATION
} from "../public/composer-submit-route.js";

test("an attachment keeps the existing BP review flow without confirmation", () => {
  let confirmed = false;
  const result = decideComposerSubmission({
    taskType: "attachment_review",
    hasFile: true,
    confirmImpl: () => { confirmed = true; return true; }
  });
  assert.equal(result, ATTACHMENT_SUBMISSION);
  assert.equal(confirmed, false);
});

test("a completed conversation without a new file remains a follow-up", () => {
  let confirmed = false;
  const result = decideComposerSubmission({
    taskType: "attachment_review",
    hasCurrentReport: true,
    hasFile: false,
    confirmImpl: () => { confirmed = true; return true; }
  });
  assert.equal(result, FOLLOWUP_SUBMISSION);
  assert.equal(confirmed, false);
});

test("no attachment offers company pre-research and honors confirmation", () => {
  let message = "";
  const confirmed = decideComposerSubmission({
    taskType: "attachment_review",
    hasFile: false,
    confirmImpl: (value) => { message = value; return true; }
  });
  assert.equal(confirmed, COMPANY_RESEARCH_SUBMISSION);
  assert.equal(message, NO_ATTACHMENT_CONFIRMATION);

  const cancelled = decideComposerSubmission({
    taskType: "attachment_review",
    hasFile: false,
    confirmImpl: () => false
  });
  assert.equal(cancelled, CANCEL_SUBMISSION);
});

test("explicit company research mode submits without another confirmation", () => {
  let confirmed = false;
  const result = decideComposerSubmission({
    taskType: "company_pre_research",
    hasFile: false,
    confirmImpl: () => { confirmed = true; return false; }
  });
  assert.equal(result, COMPANY_RESEARCH_SUBMISSION);
  assert.equal(confirmed, false);
});
