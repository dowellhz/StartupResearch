import test from "node:test";
import assert from "node:assert/strict";
import { planReviewResearchTools } from "../src/domain/research-tool-planner.js";

test("biotech academic teams automatically use clinical and scholar research tools", () => {
  const tools = planReviewResearchTools({
    companyProfile: { sector: "生物医药" },
    claims: [{ statement: "教授团队开发 siRNA 药物", verificationNeed: "核查论文和临床管线" }]
  });
  assert.deepEqual(tools, ["general_web_search", "clinical_trials_search", "google_scholar_search"]);
});

test("ordinary commercial reviews retain general web search", () => {
  assert.deepEqual(planReviewResearchTools({ companyProfile: { sector: "消费零售" }, claims: [] }), ["general_web_search"]);
});
