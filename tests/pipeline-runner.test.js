import test from "node:test";
import assert from "node:assert/strict";
import { createPipelineRunner } from "../src/domain/pipeline-runner.js";

test("shared pipeline runner restores checkpoints and persists later steps", async () => {
  const saved = [];
  const events = [];
  const repository = { save: async (job) => { saved.push(job.id); return job; } };
  const steps = [
    { key: "restored", label: "恢复", run: async () => { throw new Error("must not run"); } },
    { key: "next", label: "继续", run: async (context) => ({ ...context, value: context.value + 1 }) }
  ];
  const runner = createPipelineRunner({
    steps,
    repository,
    saveCheckpoint: async (context, step) => ({ ...context, job: { ...context.job, checkpoints: { ...context.job.checkpoints, [step.key]: { completed: true, artifact: { value: context.value } } } } }),
    onComplete: (context) => context.onEvent({ type: "complete", data: { value: context.value } })
  });
  const result = await runner.execute({ id: "job_runner", stages: steps, checkpoints: { restored: { completed: true, artifact: { value: 4 } } } }, { onEvent: (event) => events.push(event) });
  assert.equal(result.ok, true);
  assert.equal(result.value.value, 5);
  assert.equal(events.some((event) => event.data?.status === "restored"), true);
  assert.equal(saved.length, 1);
});

test("shared pipeline runner exposes a generic stage failure", async () => {
  const events = [];
  const repository = { save: async (job) => job };
  const runner = createPipelineRunner({
    steps: [{ key: "secret", label: "失败", run: async () => { throw new Error("/private/key/path"); } }],
    repository,
    saveCheckpoint: async (context) => context
  });
  const result = await runner.execute({ id: "job_failed", stages: [{ key: "secret" }], checkpoints: {} }, { onEvent: (event) => events.push(event) });
  assert.equal(result.ok, false);
  assert.doesNotMatch(events.at(-1).data.message, /private/);
});
