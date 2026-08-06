import test from "node:test";
import assert from "node:assert/strict";
import { supportsEvidenceRefresh, taskTypeLabels } from "../public/task-type-labels.js";

test("research task types expose distinct UI labels and refresh policy", () => {
  assert.equal(taskTypeLabels("industry_research").report, "行业研究报告");
  assert.equal(taskTypeLabels("paper_analysis").eyebrow, "PAPER ANALYSIS REPORT");
  assert.equal(supportsEvidenceRefresh("paper_analysis"), false);
  assert.equal(supportsEvidenceRefresh("attachment_review"), true);
});
