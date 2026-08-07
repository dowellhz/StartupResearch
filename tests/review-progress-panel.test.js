import test from "node:test";
import assert from "node:assert/strict";
import { updateReviewStages } from "../public/review-progress-panel.js";

test("progress updates replace known stages and append stages missing from an old snapshot", () => {
  const initial = [{ key: "document-parse", label: "解析", status: "pending" }];
  const completed = updateReviewStages(initial, { key: "document-parse", status: "completed", message: "已解析 16 页" });
  const expanded = updateReviewStages(completed, { key: "evidence-verification", label: "核验证据", status: "running" });
  assert.equal(expanded[0].status, "completed");
  assert.equal(expanded[0].message, "已解析 16 页");
  assert.equal(expanded[1].key, "evidence-verification");
  assert.equal(expanded[1].status, "running");
});
