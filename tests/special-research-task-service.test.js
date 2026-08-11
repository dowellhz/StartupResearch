import test from "node:test";
import assert from "node:assert/strict";
import { createSpecialResearchTaskService } from "../src/domain/special-research-task-service.js";

test("special research task service persists industry and paper jobs with explicit pipelines", async () => {
  const jobs = [];
  const uploads = [];
  const queued = [];
  const repository = {
    list: async () => jobs,
    save: async (job) => { jobs.push(job); return job; },
    saveUpload: async (id, buffer) => { uploads.push({ id, buffer }); return `20260806/${id}.source`; }
  };
  const service = createSpecialResearchTaskService({ repository, industryResearchPipeline: { steps: [] }, paperAnalysisPipeline: { steps: [] }, enqueue: (id) => queued.push(id) });
  const industry = await service.create({ taskType: "industry_research", companyName: "低空经济", outputLanguage: "en", researchTemplate: "investment" }, { ownerId: "browser-1" });
  const paper = await service.create({ taskType: "paper_analysis", companyName: "Paper", outputLanguage: "en", upload: { filename: "paper.pdf", mimeType: "application/pdf", data: Buffer.from("pdf").toString("base64") } }, { ownerId: "browser-1" });
  assert.equal(industry.taskType, "industry_research");
  assert.equal(paper.taskType, "paper_analysis");
  assert.equal(industry.outputLanguage, "en");
  assert.equal(paper.outputLanguage, "en");
  assert.equal(paper.upload.persisted, true);
  assert.equal(uploads.length, 1);
  assert.deepEqual(queued, [industry.id, paper.id]);
});

test("paper analysis requires a PDF upload or public URL", async () => {
  const service = createSpecialResearchTaskService({ repository: { list: async () => [] }, paperAnalysisPipeline: { steps: [] } });
  await assert.rejects(service.create({ taskType: "paper_analysis" }, { ownerId: "browser-1" }), /上传 PDF 或填写论文 URL/);
});
