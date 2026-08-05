import test from "node:test";
import assert from "node:assert/strict";
import { submitCompanyPreResearch, submitUploadedBp } from "../public/review-submit.js";

test("company pre-research submits an explicit task type without an attachment", async () => {
  let request;
  const requestJson = async (url, options) => { request = { url, options }; return { ok: true }; };
  await submitCompanyPreResearch({ requestJson, companyName: "示例科技", instruction: "关注团队" });
  assert.equal(request.url, "/api/reviews");
  assert.deepEqual(JSON.parse(request.options.body), {
    taskType: "company_pre_research",
    companyName: "示例科技",
    instruction: "关注团队"
  });
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
