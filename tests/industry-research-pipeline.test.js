import test from "node:test";
import assert from "node:assert/strict";
import { createIndustryResearchJob, createIndustryResearchPipeline } from "../src/domain/industry-research-pipeline.js";
import { resolveIndustryResearchTemplate } from "../src/domain/industry-research-prompts.js";

test("industry research plans queries, uses public tools and checkpoints a report", async () => {
  let savedJob;
  let storedReport = "";
  let searched;
  let completionCalls = 0;
  const repository = {
    save: async (job) => { savedJob = structuredClone(job); return job; },
    saveReport: async (_id, report) => { storedReport = report; }
  };
  const model = {
    complete: async () => {
      completionCalls += 1;
      if (completionCalls === 1) return JSON.stringify({ objective: "研究具身智能", scope: {}, questions: [{ id: "q1", question: "市场规模？", importance: "high", evidenceTypes: ["统计"] }], queryGroups: [{ id: "g1", queries: ["具身智能 市场规模", "具身智能 论文"], preferredSources: ["官方"] }] });
      return JSON.stringify({ findings: [{ domain: "市场规模", statement: "公开来源给出行业规模口径", sourceIds: ["source_1"], confidence: "medium", nature: "source_claim" }], risks: [], unknowns: ["统一口径"] });
    },
    webSearch: async (input) => {
      searched = input;
      return [{ title: "行业报告", url: "https://example.com/report", snippet: "具身智能行业规模按中国市场口径统计。" }];
    },
    stream: async (_messages, { onDelta }) => {
      const sections = ["研究结论摘要", ...resolveIndustryResearchTemplate("technical").sections, "参考来源"];
      const report = `# 具身智能 · 技术研究\n\n${sections.map((section) => `## ${section}\n\n[行业报告](https://example.com/report) 提供公开证据。`).join("\n\n")}\n\n${"技术研究。".repeat(300)}`;
      onDelta(report);
      return report;
    }
  };
  const pipeline = createIndustryResearchPipeline({ model, repository });
  const job = createIndustryResearchJob({ topic: "具身智能", instruction: "关注技术路线", researchTemplate: "technical", steps: pipeline.steps });
  const result = await pipeline.execute(job);
  assert.equal(result.ok, true, result.error);
  assert.equal(savedJob.taskType, "industry_research");
  assert.equal(savedJob.status, "needs_attention");
  assert.equal(Object.keys(savedJob.checkpoints).length, pipeline.steps.length);
  assert.equal(searched.requestedTools.includes("general_web_search"), true);
  assert.equal(searched.requestedTools.includes("arxiv_paper_search"), true);
  assert.match(storedReport, /## 代表论文与开源项目/);
});
