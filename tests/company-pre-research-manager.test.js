import test from "node:test";
import assert from "node:assert/strict";
import { createReviewManagerService } from "../src/domain/review-manager-service.js";
import { Result } from "../src/domain/result.js";

test("review manager dispatches explicit company pre-research without requiring an upload", async () => {
  const jobs = new Map();
  let selectedPipeline = "";
  const repository = {
    list: async () => Array.from(jobs.values()),
    get: async (id) => jobs.get(id),
    save: async (job) => { jobs.set(job.id, job); return job; }
  };
  const pipeline = { steps: [], execute: async () => { selectedPipeline = "attachment"; return Result.ok({}); } };
  const companyResearchPipeline = {
    steps: [{ key: "public-research", label: "抓取公司公开信息" }],
    execute: async () => { selectedPipeline = "company"; return Result.ok({}); }
  };
  const manager = createReviewManagerService({ pipeline, companyResearchPipeline, repository, model: {} });
  const review = await manager.create({ taskType: "company_pre_research", companyName: "示例科技", instruction: "关注团队" }, { ownerId: "browser-1" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(review.taskType, "company_pre_research");
  assert.equal(review.upload, null);
  assert.match(review.id, /^research_/);
  assert.equal(selectedPipeline, "company");
  await assert.rejects(
    manager.create({ taskType: "company_pre_research", companyName: "" }, { ownerId: "browser-1" }),
    /填写公司名称/
  );
});
