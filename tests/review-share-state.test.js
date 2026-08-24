import test from "node:test";
import assert from "node:assert/strict";
import { forkSharedReview, isPristineSharedReview, reviewContentVersion } from "../src/domain/review-share-state.js";

test("review content versions change only with visible snapshot content", () => {
  const review = { id: "bp_source", title: "光互联", updatedAt: "old", messages: [{ role: "user", content: "问题", status: "complete" }] };
  const version = reviewContentVersion(review, "# 报告");
  assert.equal(reviewContentVersion({ ...review, updatedAt: "new" }, "# 报告"), version);
  assert.notEqual(reviewContentVersion({ ...review, messages: [...review.messages, { role: "assistant", content: "回答", status: "complete" }] }, "# 报告"), version);
  assert.notEqual(reviewContentVersion(review, "# 新报告"), version);
});

test("the first recipient write turns a pristine shared snapshot into a fork", () => {
  const shared = { id: "copy_review", shareOrigin: { sourceReviewId: "bp_source", sourceVersion: "v1", importedAt: "before", forkedAt: "" } };
  assert.equal(isPristineSharedReview(shared), true);
  const forked = forkSharedReview(shared, "followup", "after");
  assert.equal(isPristineSharedReview(forked), false);
  assert.equal(forked.shareOrigin.forkedAt, "after");
  assert.equal(forked.shareOrigin.forkReason, "followup");
  assert.equal(forkSharedReview(forked, "reanalyze", "later").shareOrigin.forkReason, "followup");
});
