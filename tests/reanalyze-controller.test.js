import test from "node:test";
import assert from "node:assert/strict";
import { confirmationMessage, createReanalyzeController } from "../public/reanalyze-controller.js";

test("reanalyze controller uses task-specific copy and updates the running snapshot", async () => {
  const state = { currentId: "industry_1", currentReview: { taskType: "industry_research" }, report: "old" };
  const calls = [];
  const run = createReanalyzeController({ state, confirmImpl: () => true, requestJson: async () => ({ review: { id: "industry_1", taskType: "industry_research", stages: [{ key: "plan" }] } }), renderProgress: () => calls.push("render"), focusResearchStart: () => calls.push("focus"), connectEvents: (id) => calls.push(id), notify: (message) => calls.push(message), labelFor: () => ({ rerun: "重新研究" }) });
  await run();
  assert.match(confirmationMessage("industry_research"), /重新规划/);
  assert.equal(state.report, "");
  assert.equal(state.autoFollow, false);
  assert.deepEqual(calls.slice(0, 3), ["render", "focus", "industry_1"]);
});
