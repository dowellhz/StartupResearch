import test from "node:test";
import assert from "node:assert/strict";
import { validateInput } from "../public/research-submission-controller.js";

test("research submission validates the distinct subject and paper source requirements", () => {
  assert.match(validateInput({ taskType: "industry_research", subject: "" }), /行业或技术主题/);
  assert.match(validateInput({ taskType: "paper_analysis", sourceUrl: "" }), /上传 PDF/);
  assert.equal(validateInput({ taskType: "paper_analysis", sourceUrl: "https://arxiv.org/abs/2608.1" }), "");
  assert.equal(validateInput({ taskType: "paper_analysis", file: { name: "paper.pdf" } }), "");
  assert.match(validateInput({ taskType: "paper_analysis", file: { name: "notes.docx" } }), /仅支持 PDF/);
});
