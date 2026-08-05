import test from "node:test";
import assert from "node:assert/strict";
import { buildReviewResearchPlan, planReviewResearchTools } from "../src/domain/research-tool-planner.js";

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

test("research plan assigns queries to high-priority claims across domains", () => {
  const plan = buildReviewResearchPlan({
    searchQueries: ["示例科技 公司 融资"],
    claims: [
      { id: "c1", domain: "团队", importance: "critical", statement: "CEO 曾任头部公司高管", verificationNeed: "核查 CEO 公开任职" },
      { id: "c2", domain: "客户", importance: "high", statement: "已有十家付费客户", verificationNeed: "核查客户公开合作" },
      { id: "c3", domain: "团队", importance: "high", statement: "CTO 拥有核心专利", verificationNeed: "核查 CTO 专利" }
    ]
  }, { companyName: "示例科技" });
  assert.equal(plan.claimPlans.length, 3);
  assert.deepEqual(plan.claimPlans.slice(0, 2).map((item) => item.domain), ["团队", "客户"]);
  assert.ok(plan.searchQueries.some((query) => query.includes("核查 CEO 公开任职")));
  assert.deepEqual(plan.coverageTargets, ["c1", "c2", "c3"]);
});
