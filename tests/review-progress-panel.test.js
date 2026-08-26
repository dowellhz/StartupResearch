import test from "node:test";
import assert from "node:assert/strict";
import { reviewProgressPresentation, updateReviewStages } from "../public/review-progress-panel.js";

test("progress updates replace known stages and append stages missing from an old snapshot", () => {
  const initial = [{ key: "document-parse", label: "解析", status: "pending" }];
  const completed = updateReviewStages(initial, { key: "document-parse", status: "completed", message: "已解析 16 页" });
  const expanded = updateReviewStages(completed, { key: "evidence-verification", label: "核验证据", status: "running" });
  assert.equal(expanded[0].status, "completed");
  assert.equal(expanded[0].message, "已解析 16 页");
  assert.equal(expanded[1].key, "evidence-verification");
  assert.equal(expanded[1].status, "running");
});

test("progress presentation exposes stop while active and resume after stopping", () => {
  assert.equal(reviewProgressPresentation({ status: "running", taskLabel: "公司预研" }).action, "cancel");
  const stopped = reviewProgressPresentation({ status: "cancelled", taskLabel: "公司预研" });
  assert.equal(stopped.action, "resume");
  assert.match(stopped.title, /已停止/);
  assert.equal(reviewProgressPresentation({ status: "cancelled", resumePending: true, taskLabel: "公司预研" }).action, "resuming");
});
