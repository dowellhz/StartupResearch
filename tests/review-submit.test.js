import test from "node:test";
import assert from "node:assert/strict";
import { submitCompanyPreResearch, submitIndustryResearch, submitPaperAnalysis, submitUploadedBp } from "../public/review-submit.js";

test("company pre-research submits an explicit task type without an attachment", async () => {
  let request;
  const requestJson = async (url, options) => { request = { url, options }; return { ok: true }; };
  await submitCompanyPreResearch({ requestJson, companyName: "示例科技", instruction: "关注团队", outputLanguage: "en" });
  assert.equal(request.url, "/api/reviews");
  assert.deepEqual(JSON.parse(request.options.body), {
    taskType: "company_pre_research",
    companyName: "示例科技",
    instruction: "关注团队",
    outputLanguage: "en"
  });
});

test("industry research and paper analysis submit explicit payloads", async () => {
  const requests = [];
  const requestJson = async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true }; };
  await submitIndustryResearch({ requestJson, topic: "低空经济", instruction: "关注投资", researchTemplate: "investment" });
  await submitPaperAnalysis({ requestJson, title: "Paper", instruction: "关注复现", sourceUrl: "https://arxiv.org/abs/1" });
  assert.deepEqual(requests[0], { taskType: "industry_research", companyName: "低空经济", instruction: "关注投资", researchTemplate: "investment" });
  assert.equal(requests[1].taskType, "paper_analysis");
  assert.equal(requests[1].sourceUrl, "https://arxiv.org/abs/1");
});

test("an attachment dragged into a company research conversation starts the original attachment flow", async () => {
  let request;
  const requestJson = async (url, options) => { request = { url, options }; return { ok: true }; };
  await submitUploadedBp({
    requestJson,
    currentId: "research_1",
    currentReview: { taskType: "company_pre_research", reportAvailable: true },
    companyName: "示例科技",
    instruction: "解读会议材料",
    file: { name: "meeting.pdf", type: "application/pdf", size: 12 },
    data: "cGRm"
  });
  assert.equal(request.url, "/api/reviews");
  assert.equal(JSON.parse(request.options.body).file.filename, "meeting.pdf");
});

test("a new BP always creates a separate review even when the current review is complete", async () => {
  let request;
  const requestJson = async (url, options) => { request = { url, options }; return { ok: true }; };
  await submitUploadedBp({
    requestJson,
    currentId: "bp_existing",
    currentReview: { taskType: "attachment_review", reportAvailable: true },
    companyName: "华震工业",
    instruction: "核查新 BP",
    file: { name: "new-bp.pdf", type: "application/pdf", size: 12 },
    data: "cGRm"
  });
  assert.equal(request.url, "/api/reviews");
  assert.equal(JSON.parse(request.options.body).apply, undefined);
});
