import test from "node:test";
import assert from "node:assert/strict";
import { createReviewCancellationController } from "../public/review-cancellation-controller.js";

test("cancel and resume update the current review and event connection", async () => {
  const state = { currentId: "company_1", currentReview: { id: "company_1", status: "running" }, stages: [] };
  const calls = [];
  const requestJson = async (url) => {
    calls.push(url);
    const status = url.endsWith("/cancel") ? "cancelled" : "running";
    return { review: { id: state.currentId, status, stages: [{ key: "search", status }] } };
  };
  const controller = createReviewCancellationController({
    state,
    requestJson,
    confirmImpl: () => true,
    closeEvents: () => calls.push("close"),
    renderProgress: () => calls.push("render"),
    focusResearchStart: () => calls.push("focus"),
    connectEvents: (id) => calls.push(`connect:${id}`),
    refreshHistory: async () => calls.push("history"),
    notify: () => {}
  });

  await controller.cancel();
  assert.equal(state.currentReview.status, "cancelled");
  await controller.resume();
  assert.equal(state.currentReview.status, "running");
  assert.deepEqual(calls.filter((value) => String(value).startsWith("/api/")), ["/api/reviews/company_1/cancel", "/api/reviews/company_1/retry"]);
  assert.ok(calls.includes("close"));
  assert.ok(calls.includes("connect:company_1"));
});

test("停止研究等待异步确认弹窗；用户取消时不发请求", async () => {
  const state = { currentId: "bp_1", currentReview: { status: "running" } };
  let requested = false;
  const controller = createReviewCancellationController({
    state,
    confirmImpl: async () => false,
    requestJson: async () => { requested = true; return { review: {} }; },
    closeEvents: () => {}, renderProgress: () => {}, connectEvents: () => {}, refreshHistory: () => {}, notify: () => {}
  });
  await controller.cancel();
  assert.equal(requested, false);
});
