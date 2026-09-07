import test from "node:test";
import assert from "node:assert/strict";
import { createReviewManagerService } from "../src/domain/review-manager-service.js";
import { createBoundedTaskQueue } from "../src/infra/bounded-task-queue.js";
import { operationalError, publicError } from "../src/infra/public-error.js";

// 队列上限是「准入控制」：必须在任务落盘之前判定。否则被拒的任务已经保存，
// 会变成永远不执行、也不通知用户、却持续占用其活动额度的僵尸任务。
function createRepository(jobs) {
  return {
    listSummaries: async ({ ownerId }) => Array.from(jobs.values())
      .filter((job) => job.ownerId === ownerId)
      .map((job) => ({ id: job.id, ownerId: job.ownerId, status: job.status, taskType: job.taskType, instruction: job.instruction, outputLanguage: job.outputLanguage, uploadSetHash: job.uploadSetHash })),
    list: async ({ ownerId }) => Array.from(jobs.values()).filter((job) => job.ownerId === ownerId),
    saveUpload: async (id) => `20260907/${id}.source`,
    save: async (job) => { jobs.set(job.id, structuredClone(job)); return job; },
    get: async (id) => jobs.get(id) || null,
    getReport: async () => ""
  };
}

function createHarness({ concurrency = 1, maxPending = 1, maxActivePerOwner = 9, taskQueue } = {}) {
  const jobs = new Map();
  const released = [];
  const pipeline = {
    steps: [{ key: "noop", label: "noop" }],
    execute: () => new Promise((resolve) => released.push(() => resolve({ ok: true })))
  };
  const queue = taskQueue || createBoundedTaskQueue({ concurrency, maxPending });
  const manager = createReviewManagerService({ pipeline, repository: createRepository(jobs), model: {}, taskQueue: queue, maxActivePerOwner });
  return { jobs, manager, released, queue };
}

const settle = async () => { for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const upload = (seed) => ({ filename: `${seed}.pdf`, data: Buffer.from(seed).toString("base64") });
const submit = (manager, seed, ownerId) => manager.create({ companyName: seed, instruction: seed, upload: upload(seed) }, { ownerId });

test("队列已满时提交直接返回 429，且不落盘僵尸任务", async () => {
  const { jobs, manager } = createHarness({ concurrency: 1, maxPending: 1 });

  const first = await submit(manager, "A", "owner-q");
  await settle();
  const second = await submit(manager, "B", "owner-q");
  await settle();

  let failure;
  try {
    await submit(manager, "C", "owner-q");
  } catch (error) {
    failure = publicError(error);
  }

  assert.ok(failure, "队列已满时第三个提交必须失败，而不是返回成功");
  assert.equal(failure.status, 429);
  assert.equal(failure.body.code, "task_queue_full");
  // 关键：被拒的任务不能留在仓库里，否则它会一直算作该用户的活动任务
  assert.deepEqual([...jobs.keys()].sort(), [first.id, second.id].sort());
});

test("被队列拒绝不占用 owner 额度，排空后同一提交可以成功", async () => {
  const { manager, released } = createHarness({ concurrency: 1, maxPending: 1, maxActivePerOwner: 9 });

  await submit(manager, "A", "owner-r");
  await settle();
  await submit(manager, "B", "owner-r");
  await settle();
  await assert.rejects(submit(manager, "C", "owner-r"), (error) => error.code === "task_queue_full");

  while (released.length) released.shift()();
  await settle();
  while (released.length) released.shift()();
  await settle();

  const retried = await submit(manager, "C", "owner-r");
  assert.ok(retried.id);
});

test("预占的队列位在任务落盘后交给入队，不会被重复计数", async () => {
  const { manager, queue, released } = createHarness({ concurrency: 1, maxPending: 3 });
  await submit(manager, "A", "owner-t");
  await settle();
  await submit(manager, "B", "owner-t");
  await settle();

  const snapshot = queue.snapshot();
  assert.equal(snapshot.reserved, 0, "预占位必须在入队时归还，否则会虚占队列深度");
  assert.equal(snapshot.active + snapshot.pending, 2);

  while (released.length) released.shift()();
  await settle();
});

test("已落盘任务若仍未能入队，标记为失败并带上可读原因，而不是停在 queued", async () => {
  // 模拟残余竞态：准入拿到了队列位，真正入队时队列仍拒绝。
  const taskQueue = {
    reserve: () => () => {},
    run: () => Promise.reject(operationalError("研究队列已满，请稍后再提交", { statusCode: 429, code: "task_queue_full" }))
  };
  const { jobs, manager } = createHarness({ taskQueue, maxActivePerOwner: 1 });

  const created = await submit(manager, "A", "owner-u");
  await settle();

  const stored = jobs.get(created.id);
  assert.equal(stored.status, "failed", "入队失败的任务不能停留在 queued");
  assert.equal(stored.failedStep, "queue-admission");
  assert.match(stored.error, /队列/);

  // failed 是终态，不再占用活动额度：同一 owner 应能立即重新提交
  const next = await submit(manager, "B", "owner-u");
  assert.ok(next.id);
});

test("启动恢复不受排队上限拦截：已准入的任务必须能继续执行", async () => {
  const jobs = new Map();
  const repository = createRepository(jobs);
  let executed = false;
  const pipeline = { steps: [{ key: "noop", label: "noop" }], execute: async () => { executed = true; return { ok: true }; } };
  const queue = createBoundedTaskQueue({ concurrency: 1, maxPending: 1 });
  const manager = createReviewManagerService({ pipeline, repository, model: {}, taskQueue: queue, maxActivePerOwner: 9 });

  await repository.save({ id: "bp_recovered0001", ownerId: "owner-v", status: "queued", taskType: "attachment_review", stages: [{ key: "noop", label: "noop", status: "pending" }] });

  // 重启后排队位可能已被其他恢复任务占满；恢复的是此前已准入的任务，不应再被拦截
  const filler = queue.reserve();
  assert.throws(() => queue.reserve(), (error) => error.code === "task_queue_full");

  await manager.run("bp_recovered0001", "owner-v");
  assert.equal(executed, true, "恢复的任务被排队上限拒绝了");
  assert.equal(jobs.get("bp_recovered0001").status, "running");
  filler();
});
