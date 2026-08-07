import test from "node:test";
import assert from "node:assert/strict";
import { recoverActiveReviews } from "../src/domain/startup-recovery-service.js";

test("startup recovery stops stale jobs and resumes recent jobs", async () => {
  const calls = { failed: [], resumed: [], refreshes: [] };
  const manager = {
    failInterrupted: async (id, reason) => calls.failed.push({ id, reason }),
    run: async (id) => calls.resumed.push(id),
    runEvidenceRefresh: async (id) => calls.refreshes.push(id)
  };
  const result = await recoverActiveReviews({
    jobs: [
      { id: "bp_stale", status: "running", updatedAt: "2026-08-07T00:00:00Z", stages: [{ status: "running", updatedAt: "2026-08-07T00:00:00Z" }] },
      { id: "bp_recent", status: "running", updatedAt: "2026-08-07T00:19:00Z" },
      { id: "bp_done", status: "completed", evidenceRefresh: { status: "running" } }
    ],
    manager,
    staleAfterMs: 10 * 60 * 1000,
    now: () => "2026-08-07T00:20:00Z"
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(result, { resumed: ["bp_recent"], failed: ["bp_stale"], refreshes: ["bp_done"] });
  assert.equal(calls.failed[0].id, "bp_stale");
  assert.match(calls.failed[0].reason, /手动重试/);
  assert.deepEqual(calls.resumed, ["bp_recent"]);
  assert.deepEqual(calls.refreshes, ["bp_done"]);
});
