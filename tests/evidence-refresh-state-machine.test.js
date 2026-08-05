import test from "node:test";
import assert from "node:assert/strict";
import { transitionEvidenceRefresh } from "../src/domain/evidence-refresh-state-machine.js";

test("evidence refresh state machine allows only explicit terminal transitions", () => {
  const running = transitionEvidenceRefresh({ status: "queued" }, "running");
  assert.equal(transitionEvidenceRefresh(running, "completed").status, "completed");
  assert.equal(transitionEvidenceRefresh(running, "needs_attention").status, "needs_attention");
  assert.equal(transitionEvidenceRefresh(running, "failed").status, "failed");
  assert.throws(() => transitionEvidenceRefresh({ status: "completed" }, "running"), /非法资料刷新状态迁移/);
});
