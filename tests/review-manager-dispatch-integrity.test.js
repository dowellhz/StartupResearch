import test from "node:test";
import assert from "node:assert/strict";
import { createReviewManagerService } from "../src/domain/review-manager-service.js";
import { createBoundedTaskQueue } from "../src/infra/bounded-task-queue.js";
import { createOwnerCapacityGuard } from "../src/domain/review-owner-capacity.js";

function createRepository(jobs, { onSave } = {}) {
  return {
    listSummaries: async ({ ownerId }) => Array.from(jobs.values())
      .filter((job) => job.ownerId === ownerId)
      .map((job) => ({ id: job.id, ownerId: job.ownerId, status: job.status, taskType: job.taskType, instruction: job.instruction, outputLanguage: job.outputLanguage, uploadSetHash: job.uploadSetHash })),
    list: async ({ ownerId }) => Array.from(jobs.values()).filter((job) => job.ownerId === ownerId),
    saveUpload: async (id) => `20260907/${id}.source`,
    save: async (job) => { await onSave?.(job); jobs.set(job.id, structuredClone(job)); return job; },
    get: async (id) => jobs.get(id) || null,
    getReport: async () => "",
    removePdf: async () => false,
    archiveReport: async () => ""
  };
}

const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const upload = (seed) => ({ filename: `${seed}.pdf`, data: Buffer.from(seed).toString("base64") });
const submit = (manager, seed, ownerId) => manager.create({ companyName: seed, instruction: seed, upload: upload(seed) }, { ownerId });

test("预占的队列位必须持有到交出为止，release() 只归还 owner 锁", async () => {
  const jobs = new Map();
  const queue = createBoundedTaskQueue({ concurrency: 1, maxPending: 1 });
  const guard = createOwnerCapacityGuard({ repository: createRepository(jobs), taskQueue: queue, maxActivePerOwner: 5 });

  const admission = await guard.admit("owner-1");
  assert.equal(queue.snapshot().reserved, 1);

  // 任务落盘后先放 owner 锁——此时队列位还没交给入队，必须继续持有，
  // 否则其他用户能在「已释放、尚未入队」的窗口里抢走它，双方都进队 → 超卖。
  admission.release();
  assert.equal(queue.snapshot().reserved, 1, "release() 提前归还了队列位");

  await assert.rejects(
    (async () => guard.admit("owner-2"))(),
    (error) => error.code === "task_queue_full",
    "队列位已被预占，另一名用户不应通过准入"
  );

  const slot = admission.useSlot();
  assert.equal(queue.snapshot().reserved, 1, "useSlot() 只移交所有权，不应归还");
  slot();
  assert.equal(queue.snapshot().reserved, 0, "真正入队时才归还预占位");
});

test("未使用的预占位在 finally 中归还，不会永久虚占队列深度", async () => {
  const jobs = new Map();
  const queue = createBoundedTaskQueue({ concurrency: 1, maxPending: 1 });
  const guard = createOwnerCapacityGuard({ repository: createRepository(jobs), taskQueue: queue, maxActivePerOwner: 5 });

  await assert.rejects(guard.withAdmission("owner-1", async () => { throw new Error("落盘失败"); }), /落盘失败/);
  assert.equal(queue.snapshot().reserved, 0);
  await assert.doesNotReject(guard.admit("owner-2"));
});

test("并发提交不会超卖排队位：预占位必须持有到实际入队", async () => {
  const jobs = new Map();
  const queue = createBoundedTaskQueue({ concurrency: 1, maxPending: 1 });
  const pipeline = { steps: [{ key: "noop", label: "noop" }], execute: () => new Promise(() => {}) };
  const manager = createReviewManagerService({ pipeline, repository: createRepository(jobs), model: {}, taskQueue: queue, maxActivePerOwner: 5 });

  // 先占满执行槽
  await submit(manager, "warm", "owner-0");
  await settle();
  assert.equal(queue.snapshot().active, 1);

  // 两名用户并发提交，等待上限只有 1
  const results = await Promise.allSettled([
    submit(manager, "A", "owner-1"),
    submit(manager, "B", "owner-2")
  ]);
  await settle();

  const accepted = results.filter((item) => item.status === "fulfilled");
  const snapshot = queue.snapshot();
  assert.ok(snapshot.pending <= snapshot.maxPending, `排队深度超卖：pending=${snapshot.pending} > maxPending=${snapshot.maxPending}`);
  assert.equal(accepted.length, 1, "等待上限为 1 时只应放行一个并发提交");
  assert.equal(results.find((item) => item.status === "rejected")?.reason?.code, "task_queue_full");
});

test("执行入口保存失败后必须清理 controller，重试能真正跑起流水线", async () => {
  const jobs = new Map();
  let failNextRunningSave = true;
  let executions = 0;
  const repository = createRepository(jobs, {
    onSave: async (job) => {
      if (job.status === "running" && failNextRunningSave) {
        failNextRunningSave = false;
        throw new Error("模拟落盘失败");
      }
    }
  });
  const pipeline = {
    steps: [{ key: "noop", label: "noop" }],
    execute: async () => { executions += 1; return { ok: true }; }
  };
  const queue = createBoundedTaskQueue({ concurrency: 1, maxPending: 4 });
  const manager = createReviewManagerService({ pipeline, repository, model: {}, taskQueue: queue, maxActivePerOwner: 5 });

  const created = await submit(manager, "A", "owner-x");
  await settle();

  assert.equal(jobs.get(created.id).status, "failed", "执行入口异常应落到 failed");
  assert.equal(executions, 0);

  await manager.retry(created.id, { ownerId: "owner-x" });
  await settle();

  assert.equal(executions, 1, "重试被残留的 controller 跳过了，流水线从未执行");
  assert.equal(queue.snapshot().pending, 0);
});

test("准入失败与执行失败给出不同的失败原因，便于定位", async () => {
  const admissionJobs = new Map();
  const rejectingQueue = {
    reserve: () => () => {},
    run: () => Promise.reject(Object.assign(new Error("研究队列已满"), { statusCode: 429, code: "task_queue_full" }))
  };
  const admissionManager = createReviewManagerService({
    pipeline: { steps: [{ key: "noop", label: "noop" }], execute: async () => ({ ok: true }) },
    repository: createRepository(admissionJobs),
    model: {}, taskQueue: rejectingQueue, maxActivePerOwner: 5
  });
  const rejected = await submit(admissionManager, "A", "owner-adm");
  await settle();
  const notAdmitted = admissionJobs.get(rejected.id);
  assert.equal(notAdmitted.status, "failed");
  assert.equal(notAdmitted.failedStep, "queue-admission");
  assert.match(notAdmitted.error, /未能进入研究队列/);

  const runJobs = new Map();
  let failNextRunningSave = true;
  const runManager = createReviewManagerService({
    pipeline: { steps: [{ key: "noop", label: "noop" }], execute: async () => ({ ok: true }) },
    repository: createRepository(runJobs, {
      onSave: async (job) => {
        if (job.status === "running" && failNextRunningSave) { failNextRunningSave = false; throw new Error("模拟落盘失败"); }
      }
    }),
    model: {}, taskQueue: createBoundedTaskQueue({ concurrency: 1, maxPending: 4 }), maxActivePerOwner: 5
  });
  const started = await submit(runManager, "B", "owner-exec");
  await settle();
  const crashed = runJobs.get(started.id);
  assert.equal(crashed.status, "failed");
  assert.equal(crashed.failedStep, "task-execution");
  assert.match(crashed.error, /启动失败/);
});
