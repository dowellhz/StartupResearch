import test from "node:test";
import assert from "node:assert/strict";
import { ATTACHMENT_REVIEW, COMPANY_PRE_RESEARCH, taskTypeForFileInput } from "../public/composer-task-mode.js";

test("file selection and drag-drop always resolve to the existing attachment review flow", () => {
  assert.equal(taskTypeForFileInput(COMPANY_PRE_RESEARCH), ATTACHMENT_REVIEW);
  assert.equal(taskTypeForFileInput(ATTACHMENT_REVIEW), ATTACHMENT_REVIEW);
});
