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
  assert.deepEqual(queue.snapshot(), { active: 1, pending: 1, reserved: 0, concurrency: 1, maxPending: 0 });
  release.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  release.shift()();
  assert.deepEqual(await Promise.all(tasks), [1, 2]);
  assert.equal(maximum, 1);
});

test("排队任务按 key 公平调度，单个用户无法让其他用户饿死", async () => {
  const queue = createBoundedTaskQueue({ concurrency: 1 });
  const started = [];
  const release = [];
  const hold = (label) => queue.run(async () => {
    started.push(label);
    await new Promise((resolve) => release.push(resolve));
    return label;
  }, { key: label.split("-")[0] });

  // owner-a 先连排三个，owner-b 最后才提交
  const tasks = [hold("a-1"), hold("a-2"), hold("a-3"), hold("b-1")];
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["a-1"]);

  release.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  // 严格 FIFO 会执行 a-2；公平调度必须先让没有任务在跑的 owner-b 进来
  assert.deepEqual(started, ["a-1", "b-1"]);

  for (let step = 0; step < tasks.length && release.length; step += 1) {
    release.shift()();
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual((await Promise.all(tasks)).sort(), ["a-1", "a-2", "a-3", "b-1"]);
  assert.deepEqual(started, ["a-1", "b-1", "a-2", "a-3"]);
});

test("同一 key 之间仍然保持先进先出", async () => {
  const queue = createBoundedTaskQueue({ concurrency: 1 });
  const started = [];
  const release = [];
  const tasks = ["a-1", "a-2", "a-3"].map((label) => queue.run(async () => {
    started.push(label);
    await new Promise((resolve) => release.push(resolve));
    return label;
  }, { key: "owner-a" }));
  for (let step = 0; step < 3; step += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    release.shift()?.();
  }
  await Promise.all(tasks);
  assert.deepEqual(started, ["a-1", "a-2", "a-3"]);
});

test("排队深度超出上限时立即以 429 拒绝，而不是无限堆积", async () => {
  const queue = createBoundedTaskQueue({ concurrency: 1, maxPending: 1 });
  const release = [];
  const hold = () => queue.run(() => new Promise((resolve) => release.push(resolve)));
  const running = hold();
  const queued = hold();
  await assert.rejects(hold(), (error) => error.statusCode === 429 && error.code === "task_queue_full");
  assert.equal(queue.snapshot().maxPending, 1);
  release.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  release.shift()();
  await Promise.all([running, queued]);
});

test("队列只接受函数任务", async () => {
  const queue = createBoundedTaskQueue({ concurrency: 1 });
  await assert.rejects(queue.run("not-a-function"), /队列任务必须是函数/);
});

test("预占的排队位计入深度上限，归还后重新可用", async () => {
  const queue = createBoundedTaskQueue({ concurrency: 1, maxPending: 2 });
  const first = queue.reserve();
  const second = queue.reserve();
  assert.equal(queue.snapshot().reserved, 2);
  assert.throws(() => queue.reserve(), (error) => error.statusCode === 429 && error.code === "task_queue_full");

  second();
  second();  // 归还是幂等的，重复调用不会把计数减成负数
  assert.equal(queue.snapshot().reserved, 1);
  assert.doesNotThrow(() => queue.reserve()());
  first();
  assert.equal(queue.snapshot().reserved, 0);
});

test("带 admitted 的任务跳过深度判定，保证已预占的任务一定能入队", async () => {
  const queue = createBoundedTaskQueue({ concurrency: 1, maxPending: 1 });
  const release = [];
  const hold = (admitted) => queue.run(() => new Promise((resolve) => release.push(resolve)), { admitted });

  const running = hold(false);
  const queued = hold(false);
  await assert.rejects(hold(false), (error) => error.code === "task_queue_full");
  const admitted = hold(true);   // 已预占过的任务不受上限拦截

  while (release.length) release.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  while (release.length) release.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  while (release.length) release.shift()();
  await Promise.all([running, queued, admitted]);
});
