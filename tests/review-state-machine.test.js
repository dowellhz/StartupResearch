import test from "node:test";
import assert from "node:assert/strict";
import { transitionReview } from "../src/domain/review-state-machine.js";

test("review state machine allows only explicit transitions", () => {
  assert.equal(transitionReview({ status: "queued" }, "running").status, "running");
  assert.equal(transitionReview({ status: "completed" }, "running").status, "running");
  assert.throws(() => transitionReview({ status: "completed" }, "failed"), /非法任务状态迁移/);
});
