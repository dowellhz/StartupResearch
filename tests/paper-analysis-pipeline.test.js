import test from "node:test";
import assert from "node:assert/strict";
import { createPaperAnalysisJob, createPaperAnalysisPipeline } from "../src/domain/paper-analysis-pipeline.js";
import { PAPER_ANALYSIS_SECTIONS } from "../src/domain/paper-analysis-prompts.js";

test("paper analysis parses uploaded PDF, enriches academic evidence and checkpoints output", async () => {
  let savedJob;
  let storedReport = "";
  let searched;
  const repository = {
    getUpload: async () => Buffer.from("%PDF paper"),
    save: async (job) => { savedJob = structuredClone(job); return job; },
    saveReport: async (_id, report) => { storedReport = report; }
  };
  const extractor = { extract: async () => ({ ok: true, value: { text: "论文正文与实验结果。".repeat(200), pages: [{ page: 1, text: "Abstract 方法和实验".repeat(100) }], pageCount: 1, engine: "mock" } }) };
  const model = {
    complete: async () => JSON.stringify({ title: "Test Paper", authors: ["Alice"], institutions: ["Lab"], publicationYear: "2026", doi: "10.1/test", arxivId: "2608.00001", venue: "arXiv", abstract: "研究一种新方法", researchField: "AI", keywords: ["AI"] }),
    webSearch: async (input) => { searched = input; return [{ title: "arXiv", url: "https://arxiv.org/abs/2608.00001", snippet: "Test Paper metadata" }]; },
    stream: async (_messages, { onDelta }) => {
      const technical = ["技术问题", "方法架构", "核心算法或公式", "训练或推理流程", "实验设计与指标", "工程实现约束", "复现难点"].map((item) => `### ${item}\n\n论文原文事实（Page 1）。`).join("\n\n");
      const report = `# Test Paper · 论文解读\n\n${PAPER_ANALYSIS_SECTIONS.map((section) => `## ${section}\n\n${section === "技术分析与实现讲解" ? technical : "[arXiv](https://arxiv.org/abs/2608.00001) 提供外部资料。"}`).join("\n\n")}\n\n${"论文解读。".repeat(240)}`;
      onDelta(report);
      return report;
    }
  };
  const pipeline = createPaperAnalysisPipeline({ extractor, model, repository });
  const job = createPaperAnalysisJob({ title: "", upload: { filename: "paper.pdf", persisted: true, storagePath: "20260806/paper.source" }, steps: pipeline.steps });
  const result = await pipeline.execute(job);
  assert.equal(result.ok, true, result.error);
  assert.equal(savedJob.taskType, "paper_analysis");
  assert.equal(savedJob.companyName, "Test Paper");
  assert.equal(savedJob.status, "completed");
  assert.equal(Object.keys(savedJob.checkpoints).length, pipeline.steps.length);
  assert.deepEqual(searched.requestedTools.slice(1), ["arxiv_paper_search", "scholarly_works_search", "openalex_research_search"]);
  assert.match(storedReport, /### 复现难点/);
});

test("paper analysis accepts a safely fetched public paper URL", async () => {
  const repository = { save: async (job) => job, saveReport: async () => {} };
  const paperSourceFetcher = { fetchPage: async () => ({ ok: true, url: "https://example.com/paper.pdf", title: "paper.pdf", contentType: "application/pdf", text: "--- 第 1 页 ---\n论文正文。".repeat(120), links: [] }) };
  const model = {
    complete: async () => JSON.stringify({ title: "URL Paper" }),
    webSearch: async () => [],
    stream: async () => PAPER_ANALYSIS_SECTIONS.map((section) => `## ${section}\n\n${section === "技术分析与实现讲解" ? "### 技术问题\n### 方法架构\n### 核心算法或公式\n### 训练或推理流程\n### 实验设计与指标\n### 工程实现约束\n### 复现难点" : "正文"}`).join("\n") + "正文".repeat(1500)
  };
  const pipeline = createPaperAnalysisPipeline({ extractor: {}, model, repository, paperSourceFetcher });
  const job = createPaperAnalysisJob({ sourceUrl: "https://example.com/paper.pdf", steps: pipeline.steps });
  const result = await pipeline.execute(job);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.value.job.companyName, "URL Paper");
});
