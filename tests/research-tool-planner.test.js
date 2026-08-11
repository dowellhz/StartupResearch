import test from "node:test";
import assert from "node:assert/strict";
import { buildReviewResearchPlan, buildVerificationPacks, planReviewResearchTools } from "../src/domain/research-tool-planner.js";
import { planStructuredResearchTools } from "../src/domain/research-tool-catalog.js";

test("biotech academic teams automatically use clinical and scholar research tools", () => {
  const tools = planReviewResearchTools({
    companyProfile: { sector: "生物医药" },
    claims: [{ statement: "教授团队开发 siRNA 药物", verificationNeed: "核查论文和临床管线" }]
  });
  assert.deepEqual(tools, ["general_web_search", "clinical_trials_search", "arxiv_paper_search", "scholarly_works_search", "openalex_research_search"]);
});

test("software and AI reviews use public repository and model asset tools", () => {
  const tools = planReviewResearchTools({
    companyProfile: { sector: "AI 软件" },
    claims: [{ statement: "团队发布大模型和开源代码", verificationNeed: "核查 GitHub 与 Hugging Face 资产" }]
  });
  assert.ok(tools.includes("github_repository_search"));
  assert.ok(tools.includes("huggingface_asset_search"));
  assert.ok(tools.includes("arxiv_paper_search"));
});

test("security, US filing and EU procurement claims select their zero-key registries", () => {
  const tools = planReviewResearchTools({
    companyProfile: { sector: "美股 AI 软件" },
    claims: [{ statement: "产品曾涉及 CVE 漏洞，并进入欧盟采购中标名单", verificationNeed: "核对 SEC 10-K、NVD 和 TED 公告" }]
  });
  assert.ok(tools.includes("software_vulnerability_search"));
  assert.ok(tools.includes("sec_filing_search"));
  assert.ok(tools.includes("procurement_notice_search"));
});

test("ordinary commercial reviews retain general web search", () => {
  assert.deepEqual(planReviewResearchTools({ companyProfile: { sector: "消费零售" }, claims: [] }), ["general_web_search"]);
});

test("neurotechnology research selects paper graph and clinical registry tools", () => {
  const tools = planStructuredResearchTools("fNIRS + EEG + temporal interference 技术调研，检索论文和研究团队");
  assert.ok(tools.includes("clinical_trials_search"));
  assert.ok(tools.includes("arxiv_paper_search"));
  assert.ok(tools.includes("scholarly_works_search"));
  assert.ok(tools.includes("openalex_research_search"));
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

test("research plan adds bounded official-source verification packs", () => {
  const analysis = {
    companyProfile: { sector: "医疗器械" },
    claims: [
      { id: "team_1", domain: "团队", statement: "创始人为高校教授" },
      { id: "ip_1", domain: "技术", statement: "拥有核心专利" },
      { id: "client_1", domain: "客户", statement: "已签客户合同" }
    ]
  };
  const packs = buildVerificationPacks(analysis, { companyName: "示例医疗" });
  assert.ok(packs.length <= 6);
  assert.ok(packs.some((pack) => pack.id === "corporate"));
  assert.ok(packs.some((pack) => pack.id === "ip" && pack.claimIds.includes("ip_1")));
  assert.ok(packs.some((pack) => pack.id === "regulatory"));
  assert.ok(packs.every((pack) => pack.query.includes("示例医疗") && pack.sourcePriorities.length));
});
