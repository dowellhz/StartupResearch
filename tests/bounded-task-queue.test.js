import test from "node:test";
import assert from "node:assert/strict";
import { createBoundedTaskQueue } from "../src/infra/bounded-task-queue.js";

test("bounded task queue never exceeds its configured concurrency", async () => {
  const queue = createBoundedTaskQueue({ concurrency: 1 });
  let active = 0;
  let maximum = 0;
  const release = [];
  const tasks = [1, 2].map((value) => queue.run(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => release.push(resolve));
    active -= 1;
    return value;
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(queue.snapshot(), { active: 1, pending: 1, concurrency: 1 });
  release.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  release.shift()();
  assert.deepEqual(await Promise.all(tasks), [1, 2]);
  assert.equal(maximum, 1);
});
