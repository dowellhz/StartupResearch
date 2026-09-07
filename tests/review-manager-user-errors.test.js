import test from "node:test";
import assert from "node:assert/strict";
import { createReviewManagerService } from "../src/domain/review-manager-service.js";
import { publicError } from "../src/infra/public-error.js";

// 这些都是用户可自行纠正的情况。修复前它们是裸 Error，publicError 会判成 500 并把原因
// 替换为「服务器暂时无法完成请求」，用户完全看不到该怎么办。
function managerWith(job) {
  const jobs = new Map(job ? [[job.id, job]] : []);
  return createReviewManagerService({
    pipeline: { steps: [{ key: "noop", label: "noop" }], execute: async () => ({ ok: true }) },
    repository: {
      listSummaries: async () => [],
      list: async () => [],
      save: async (value) => { jobs.set(value.id, value); return value; },
      get: async (id) => jobs.get(id) || null,
      getReport: async () => ""
    },
    model: {}
  });
}

async function captured(operation) {
  try {
    await operation();
  } catch (error) {
    return { error, response: publicError(error) };
  }
  throw new Error("预期抛出错误，但操作成功了");
}

test("运行中的任务重复提交重新研究，返回可读的 409 而不是 500", async () => {
  const manager = managerWith({ id: "bp_running", ownerId: "owner-a", status: "running", taskType: "attachment_review", stages: [] });
  const { response } = await captured(() => manager.reanalyze("bp_running", { ownerId: "owner-a" }));
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "task_already_running");
  assert.equal(response.body.error, "任务正在运行，无需重复提交");
});

test("已完成任务不能重试，返回可读的 409", async () => {
  const manager = managerWith({ id: "bp_done", ownerId: "owner-a", status: "completed", taskType: "attachment_review", stages: [] });
  const { response } = await captured(() => manager.retry("bp_done", { ownerId: "owner-a" }));
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "retry_not_allowed");
  assert.match(response.body.error, /只有失败、需关注或已停止/);
});

test("追问内容为空返回可读的 400", async () => {
  const manager = managerWith({ id: "bp_new", ownerId: "owner-a", status: "completed", taskType: "attachment_review", stages: [] });
  const { response } = await captured(() => manager.ask("bp_new", "   ", { ownerId: "owner-a" }));
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "question_required");
});

test("报告未完成就刷新公开资料，返回可读的 409", async () => {
  const job = { id: "bp_running", ownerId: "owner-a", status: "running", taskType: "attachment_review", reportAvailable: false, stages: [] };
  const jobs = new Map([[job.id, job]]);
  const manager = createReviewManagerService({
    pipeline: { steps: [], execute: async () => ({ ok: true }) },
    repository: { listSummaries: async () => [], list: async () => [], save: async (value) => value, get: async (id) => jobs.get(id) || null, getReport: async () => "" },
    evidenceRefreshService: { createRefresh: () => ({ status: "queued" }), execute: async () => ({ ok: true }) },
    model: {}
  });
  const { response } = await captured(() => manager.refreshEvidence("bp_running", { ownerId: "owner-a" }));
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "report_not_ready");
});

test("不存在的任务返回 404 而不是 500", async () => {
  const manager = managerWith(null);
  const { response } = await captured(() => manager.get("bp_missing", { ownerId: "owner-a" }));
  assert.equal(response.status, 404);
  assert.equal(response.body.code, "review_not_found");
});

test("缺少 owner 身份返回 401", async () => {
  const manager = managerWith(null);
  const { response } = await captured(() => manager.list({}));
  assert.equal(response.status, 401);
  assert.equal(response.body.code, "owner_required");
});

test("公司预研缺少公司名返回 400", async () => {
  const manager = createReviewManagerService({
    pipeline: { steps: [], execute: async () => ({ ok: true }) },
    companyResearchPipeline: { steps: [{ key: "noop", label: "noop" }], execute: async () => ({ ok: true }) },
    repository: { listSummaries: async () => [], list: async () => [], save: async (job) => job, get: async () => null },
    model: {}
  });
  const { response } = await captured(() => manager.create({ taskType: "company_pre_research", companyName: "   " }, { ownerId: "owner-a" }));
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "company_name_required");
});
