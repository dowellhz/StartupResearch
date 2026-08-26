import test from "node:test";
import assert from "node:assert/strict";
import { createReviewCancellationService, resumedJob } from "../src/domain/review-cancellation-service.js";

test("cancellation aborts active work and reasserts the stopped state after the runner settles", async () => {
  const ownerId = "owner-a";
  let aborted = false;
  let job = { id: "company_1", ownerId, status: "running", stages: [{ key: "search", status: "running" }] };
  const controllers = new Map([[job.id, { abort: () => { aborted = true; } }]]);
  const repository = { get: async () => job, save: async (value) => { job = value; return value; } };
  const service = createReviewCancellationService({
    repository,
    controllers,
    requireOwnedJob: async () => job,
    publish: () => {},
    now: () => "2026-08-26T08:00:00.000Z"
  });

  const result = await service.cancel(job.id, { ownerId });
  assert.equal(result.status, "cancelled");
  assert.equal(job.stages[0].status, "cancelled");
  assert.equal(aborted, true);

  let waiterResolved = false;
  const waiting = service.waitForSettled(job.id).then(() => { waiterResolved = true; });
  await Promise.resolve();
  assert.equal(waiterResolved, false);
  job = { ...job, status: "completed" };
  await service.settle(job.id);
  await waiting;
  assert.equal(waiterResolved, true);
  assert.equal(job.status, "cancelled");
  assert.equal(job.updatedAt, "2026-08-26T08:00:00.000Z");
});

test("resuming clears stopped metadata and returns the interrupted stage to pending", () => {
  const resumed = resumedJob({ status: "running", stoppedAt: "before", stages: [{ key: "search", status: "cancelled", message: "stopped" }] });
  assert.equal(resumed.stoppedAt, "");
  assert.deepEqual(resumed.stages[0], { key: "search", status: "pending", message: "" });
});

test("cancellation rejects terminal work", async () => {
  const job = { id: "company_done", ownerId: "owner-a", status: "completed" };
  const service = createReviewCancellationService({ repository: {}, controllers: new Map(), requireOwnedJob: async () => job, publish: () => {} });
  await assert.rejects(service.cancel(job.id, { ownerId: job.ownerId }), (error) => error.statusCode === 409);
});
