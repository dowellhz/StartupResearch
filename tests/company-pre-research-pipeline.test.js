import test from "node:test";
import assert from "node:assert/strict";
import { createCompanyPreResearchJob, createCompanyPreResearchPipeline } from "../src/domain/company-pre-research-pipeline.js";
import { COMPANY_RESEARCH_SECTIONS } from "../src/domain/company-pre-research-prompts.js";

test("company pre-research gathers public information without an attachment and checkpoints each stage", async () => {
  let finalJob;
  let storedReport = "";
  let searched;
  const repository = {
    save: async (job) => { finalJob = structuredClone(job); return job; },
    saveReport: async (_id, report) => { storedReport = report; }
  };
  const model = {
    webSearch: async (input) => {
      searched = input;
      return [
        { title: "公司官网", url: "https://example.com/about", snippet: "示例科技面向制造企业提供工业软件产品与实施服务。" },
        { title: "融资报道", url: "https://news.example.com/funding", snippet: "示例科技宣布完成由示例资本投资的新一轮融资。" }
      ];
    },
    complete: async () => JSON.stringify({
      companyProfile: { legalName: "示例科技有限公司", oneLiner: "工业软件服务商", sector: "工业软件" },
      findings: [
        { id: "f1", domain: "产品与技术", statement: "公司官网称其提供工业软件产品", sourceIds: ["source_1"], confidence: "medium", nature: "company_claim" },
        { id: "f2", domain: "融资", statement: "第三方报道提到公司完成融资", sourceIds: ["source_2"], confidence: "medium", nature: "third_party_report" },
        { id: "f3", domain: "市场", statement: "产品面向制造企业", sourceIds: ["source_1"], confidence: "medium", nature: "company_claim" },
        { id: "f4", domain: "主体", statement: "公开名称为示例科技", sourceIds: ["source_1"], confidence: "low", nature: "inference" }
      ],
      risks: [],
      missingInformation: ["客户与财务底层数据"],
      followupQuestions: ["核心客户合同能否提供？"]
    }),
    stream: async (_messages, { onDelta }) => {
      const report = `# 示例科技 公司预研报告\n\n${COMPANY_RESEARCH_SECTIONS.map((section) => `## ${section}\n\n基于公开来源形成初步判断，关键事实仍需公司材料验证。`).join("\n\n")}\n\n${"公开信息预研说明。".repeat(220)}`;
      onDelta(report);
      return report;
    }
  };
  const pipeline = createCompanyPreResearchPipeline({ model, repository });
  const job = createCompanyPreResearchJob({ companyName: "示例科技", instruction: "关注产品和融资", steps: pipeline.steps });
  const result = await pipeline.execute(job);
  assert.equal(result.ok, true, result.error);
  assert.equal(finalJob.taskType, "company_pre_research");
  assert.equal(finalJob.upload, null);
  assert.equal(finalJob.status, "completed");
  assert.equal(Object.keys(finalJob.checkpoints).length, pipeline.steps.length);
  assert.equal(searched.requestedTools.includes("general_web_search"), true);
  assert.match(searched.queries[0], /示例科技/);
  assert.match(storedReport, /## 参考来源/);
});
