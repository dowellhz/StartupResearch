import test from "node:test";
import assert from "node:assert/strict";
import { applyRecoverableReport } from "../public/review-error.js";

test("a saved draft leaves streaming mode and renders Markdown after a final-stage error", () => {
  const state = { report: "partial", currentReview: { status: "running" } };
  const calls = [];
  const recovered = applyRecoverableReport({ report: "**完整报告**", quality: { score: 100 }, status: "needs_attention" }, {
    state,
    renderReportContent: (...args) => calls.push(args),
    renderProgressPanel: () => calls.push("progress")
  });
  assert.equal(recovered, true);
  assert.equal(state.currentReview.reportAvailable, true);
  assert.deepEqual(calls[0], ["**完整报告**", false, { score: 100 }]);
});
