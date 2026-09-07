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

test("重新研究等待异步确认弹窗；用户取消时不发请求", async () => {
  const state = { currentId: "bp_1", currentReview: { taskType: "attachment_review" } };
  let requested = false;
  const declined = createReanalyzeController({
    state,
    confirmImpl: async () => false,
    requestJson: async () => { requested = true; return { review: {} }; },
    renderProgress: () => {}, connectEvents: () => {}, notify: () => {}, labelFor: () => ({ rerun: "重新核查" })
  });
  await declined();
  assert.equal(requested, false);

  const accepted = createReanalyzeController({
    state,
    confirmImpl: async () => true,
    requestJson: async () => { requested = true; return { review: { id: "bp_1", stages: [] } }; },
    renderProgress: () => {}, connectEvents: () => {}, notify: () => {}, labelFor: () => ({ rerun: "重新核查" })
  });
  await accepted();
  assert.equal(requested, true);
});
