import test from "node:test";
import assert from "node:assert/strict";
import { createReviewManagerService } from "../src/domain/review-manager-service.js";

// 仓库同步维护索引摘要，模拟真实实现：save 之后任务立刻以 queued 计入 listSummaries。
function createRepository() {
  const jobs = new Map();
  return {
    jobs,
    listSummaries: async ({ ownerId }) => Array.from(jobs.values())
      .filter((job) => job.ownerId === ownerId)
      .map((job) => ({ id: job.id, ownerId: job.ownerId, status: job.status, taskType: job.taskType, companyName: job.companyName, instruction: job.instruction, outputLanguage: job.outputLanguage, uploadSetHash: job.uploadSetHash })),
    list: async ({ ownerId }) => Array.from(jobs.values()).filter((job) => job.ownerId === ownerId),
    saveUpload: async (id) => `20260907/${id}.source`,
    save: async (job) => { jobs.set(job.id, structuredClone(job)); return job; },
    get: async (id) => jobs.get(id) || null
  };
}

const idlePipeline = { steps: [{ key: "noop", label: "noop" }], execute: () => new Promise(() => {}) };

function upload(seed) {
  return { filename: `${seed}.pdf`, data: Buffer.from(seed).toString("base64") };
}

test("并发提交恰好用满每人任务上限，已落盘的任务不会与自己的预留重复计数", async () => {
  const repository = createRepository();
  const manager = createReviewManagerService({ pipeline: idlePipeline, repository, model: {}, maxActivePerOwner: 3 });

  const results = await Promise.allSettled([0, 1, 2, 3].map((index) => manager.create({
    companyName: `并行公司${index}`,
    instruction: `并行核查${index}`,
    upload: upload(`bp-${index}`)
  }, { ownerId: "owner-a" })));

  const accepted = results.filter((item) => item.status === "fulfilled");
  const rejected = results.filter((item) => item.status === "rejected");
  assert.equal(accepted.length, 3);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.statusCode, 429);
  assert.equal(rejected[0].reason.code, "active_task_limit");
  assert.equal(new Set(accepted.map((item) => item.value.id)).size, 3);
});

test("顺序提交同样只放行上限之内的任务", async () => {
  const repository = createRepository();
  const manager = createReviewManagerService({ pipeline: idlePipeline, repository, model: {}, maxActivePerOwner: 2 });

  await manager.create({ companyName: "A", instruction: "一", upload: upload("a") }, { ownerId: "owner-b" });
  await manager.create({ companyName: "B", instruction: "二", upload: upload("b") }, { ownerId: "owner-b" });
  await assert.rejects(
    manager.create({ companyName: "C", instruction: "三", upload: upload("c") }, { ownerId: "owner-b" }),
    (error) => error.statusCode === 429 && error.code === "active_task_limit"
  );
});

test("额度按 owner 隔离，一个用户占满不影响其他用户", async () => {
  const repository = createRepository();
  const manager = createReviewManagerService({ pipeline: idlePipeline, repository, model: {}, maxActivePerOwner: 1 });

  await manager.create({ companyName: "A", instruction: "一", upload: upload("a") }, { ownerId: "owner-x" });
  await assert.rejects(manager.create({ companyName: "B", instruction: "二", upload: upload("b") }, { ownerId: "owner-x" }), /不能超过/);
  const other = await manager.create({ companyName: "C", instruction: "三", upload: upload("c") }, { ownerId: "owner-y" });
  assert.ok(other.id);
});

test("任务落盘后必须立即释放预留额度，否则会与自身重复计数", async () => {
  const repository = createRepository();
  let openAuditGate;
  const auditGate = new Promise((resolve) => { openAuditGate = resolve; });
  let audited = false;
  const manager = createReviewManagerService({
    pipeline: idlePipeline,
    repository,
    model: {},
    maxActivePerOwner: 2,
    // 只拦住第一次创建，让后续提交能够真正走到额度判断。
    logger: { audit: async () => { if (audited) return; audited = true; await auditGate; } }
  });

  const first = manager.create({ companyName: "A", instruction: "一", upload: upload("a") }, { ownerId: "owner-c" });
  // 停在「任务已落盘、创建流程尚未走完」的窗口：此时它已在 listSummaries 里计为 queued，
  // 若创建者还攥着预留不放，同一个任务就会被计两次，把后续提交误判为超额。
  while (!audited) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(repository.jobs.size, 1);

  const second = await manager.create({ companyName: "B", instruction: "二", upload: upload("b") }, { ownerId: "owner-c" });
  assert.ok(second.id);

  openAuditGate();
  await first;
});
