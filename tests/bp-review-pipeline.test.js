import test from "node:test";
import assert from "node:assert/strict";
import { createBpReviewPipeline, createReviewJob } from "../src/domain/bp-review-pipeline.js";
import { BP_PIPELINE_VERSION, prepareJobForPipeline } from "../src/domain/bp-review-pipeline-support.js";
import { REPORT_SECTIONS } from "../src/domain/review-prompts.js";
import { createEvidenceVerificationService } from "../src/infra/evidence-verification-service.js";
import { Result } from "../src/domain/result.js";

const evidenceVerificationService = createEvidenceVerificationService();

test("legacy checkpoints invalidate downstream work when evidence verification is introduced", () => {
  const steps = ["cross-check", "evidence-verification", "investment-analysis", "quality-gate"]
    .map((key) => ({ key, label: key }));
  const migrated = prepareJobForPipeline({
    checkpoints: {
      "cross-check": { completed: true },
      "investment-analysis": { completed: true },
      "quality-gate": { completed: true }
    },
    stages: steps.filter((step) => step.key !== "evidence-verification").map((step) => ({ ...step, status: "completed" }))
  }, steps);
  assert.equal(migrated.pipelineVersion, BP_PIPELINE_VERSION);
  assert.equal(migrated.checkpoints["cross-check"].completed, true);
  assert.equal(migrated.checkpoints["investment-analysis"], undefined);
  assert.equal(migrated.stages.find((step) => step.key === "evidence-verification").status, "pending");
});

test("legacy active reviews rerun downstream stages when technology research is introduced", () => {
  const steps = ["public-research", "technology-research", "cross-check", "evidence-verification", "report-generation"]
    .map((key) => ({ key, label: key }));
  const migrated = prepareJobForPipeline({
    checkpoints: {
      "public-research": { completed: true },
      "cross-check": { completed: true },
      "evidence-verification": { completed: true },
      "report-generation": { completed: true }
    },
    stages: steps.filter((step) => step.key !== "technology-research").map((step) => ({ ...step, status: "completed" }))
  }, steps);
  assert.equal(migrated.checkpoints["public-research"].completed, true);
  assert.equal(migrated.checkpoints["cross-check"], undefined);
  assert.equal(migrated.checkpoints["report-generation"], undefined);
  assert.equal(migrated.stages.find((step) => step.key === "technology-research").status, "pending");
});

test("legacy active reviews rerun downstream stages when comparable company research is introduced", () => {
  const steps = ["technology-research", "comparable-company-research", "cross-check", "report-generation"]
    .map((key) => ({ key, label: key }));
  const migrated = prepareJobForPipeline({
    checkpoints: {
      "technology-research": { completed: true },
      "cross-check": { completed: true },
      "report-generation": { completed: true }
    },
    stages: steps.filter((step) => step.key !== "comparable-company-research").map((step) => ({ ...step, status: "completed" }))
  }, steps);
  assert.equal(migrated.checkpoints["technology-research"].completed, true);
  assert.equal(migrated.checkpoints["cross-check"], undefined);
  assert.equal(migrated.stages.find((step) => step.key === "comparable-company-research").status, "pending");
});

test("BP review pipeline checkpoints every stage and keeps a visible report", async () => {
  const saved = [];
  let report = "";
  let storedPdf = "";
  const repository = {
    save: async (job) => { saved.push(structuredClone(job)); return job; },
    saveReport: async (_id, markdown) => { report = markdown; },
    savePdf: async (_id, buffer) => { storedPdf = buffer.toString(); return "20260804/bp_test.pdf"; }
  };
  const model = {
    complete: async () => JSON.stringify({
      companyProfile: { companyName: "示例科技", companyNameConfidence: "high", companyNameEvidence: ["封面"] },
      claims: [{ id: "c1", domain: "客户", statement: "已有十家客户", bpEvidence: { pageNumber: 5, exactQuote: "公司目前已有十家客户并持续提供服务。" }, importance: "high" }],
      businessAudit: {
        metrics: [{ id: "m1", category: "customer", name: "客户数", value: 10, unit: "家", period: "当前", bpEvidence: "第5页", sourceClaimIds: ["c1"] }],
        checks: [{ id: "a1", type: "arithmetic", status: "not_calculable", severity: "medium", description: "缺少客单价，无法复算收入", formula: "收入=客户数×客单价", inputs: [], result: "", bpEvidence: "第5页", relatedMetricIds: ["m1"], nextStep: "索取客户收入明细" }],
        assumptions: []
      },
      risks: [],
      searchQueries: ["示例科技 客户"],
      missingInformation: []
    }),
    webSearch: async () => [{ title: "官方信息", url: "https://example.com", snippet: "官方信息显示已有十家客户并持续提供服务", supports: ["c1"] }],
    stream: async (_messages, { onDelta }) => {
      const value = `# 示例科技 BP 核查报告\n\n${REPORT_SECTIONS.map((section) => `## ${section}\n\n${section === "关键声明核查表" ? "| 声明 | BP依据 | 公开核验 | 判断 | 置信度 | 下一步 |\n|---|---|---|---|---|---|\n| 客户 | 第5页 | 未确认 | 仅BP自述 | 中 | 访谈 |" : "这是基于材料的详细分析，资料不足部分明确标记为分析推断。"}`).join("\n\n")}\n\n${"进一步核查说明。".repeat(220)}`;
      onDelta(value.slice(0, 100));
      onDelta(value.slice(100));
      return value;
    }
  };
  const pages = Array.from({ length: 8 }, (_, index) => ({
    page: index + 1,
    text: index === 4
      ? `公司目前已有十家客户并持续提供服务。${"客户经营与产品交付说明。".repeat(5)}`
      : `商业计划内容 ${index + 1}。${"产品、市场、团队及经营情况说明。".repeat(5)}`
  }));
  const extractor = { extract: async () => Result.ok({ text: pages.map((page) => `--- 第 ${page.page} 页 ---\n${page.text}`).join("\n\n"), pages, pageCount: 8, originalChars: 240, truncated: false, engine: "mock" }) };
  const pdfReportService = { render: async () => Buffer.from("generated-pdf") };
  const investmentAnalysisService = { analyze: async () => ({
    warning: "",
    value: {
      marketSizing: { status: "partial", scenarios: [{ name: "基准" }] },
      competitorMatrix: { rows: [{ name: "竞品甲" }] },
      decision: { stance: "conditional", vetoItems: [{ condition: "客户未复核" }] },
      versionComparison: { available: false, changes: [] }
    }
  }) };
  let technologyCalled = false;
  const technologyResearchTool = { research: async () => {
    technologyCalled = true;
    return { invoked: true, plan: { topic: "示例核心技术" }, synthesis: { findings: [], approaches: [], maturity: { stage: "validated_prototype" }, bottlenecks: [], validationPlan: [], unknowns: [] }, additionalSources: [{ title: "技术证据", url: "https://example.com/technology", snippet: "公开技术验证" }], warning: "" };
  } };
  let comparableCompanyCalled = false;
  const comparableCompanyResearchTool = { research: async () => {
    comparableCompanyCalled = true;
    return {
      invoked: true,
      plan: { scope: "企业服务软件" },
      synthesis: { dimensions: ["产品"], domesticPeers: [{ name: "国内竞品", sourceIds: ["source_1"] }], internationalPeers: [], alternatives: [], subjectPositioning: [], gaps: [] },
      additionalSources: [{ title: "国内竞品官网", url: "https://peer.example.com", snippet: "企业服务软件产品" }],
      warning: ""
    };
  } };
  const pipeline = createBpReviewPipeline({ extractor, model, repository, pdfReportService, investmentAnalysisService, evidenceVerificationService, technologyResearchTool, comparableCompanyResearchTool });
  const job = createReviewJob({
    companyName: "示例科技",
    instruction: "全面核查",
    upload: { filename: "bp.pdf", mimeType: "application/pdf", size: 10, data: Buffer.from("fake").toString("base64") },
    steps: pipeline.steps
  });
  const events = [];
  const result = await pipeline.execute(job, { onEvent: (event) => events.push(event) });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.value.job.status, "completed");
  assert.equal(result.value.job.companyName, "示例科技");
  assert.equal(result.value.job.businessAudit.summary.metricCount, 1);
  assert.equal(result.value.job.claimLedger.summary.supported, 1);
  assert.equal(result.value.job.evidenceManifest.summary.traceableDocumentClaims, 1);
  assert.equal(result.value.job.evidenceManifest.claims[0].documentCitation.verificationStatus, "verified");
  assert.equal(result.value.job.researchPlan.claimPlans[0].claimId, "c1");
  assert.equal(result.value.job.investmentAnalysis.decision.stance, "conditional");
  assert.equal(technologyCalled, true);
  assert.equal(result.value.job.technologyResearch.invoked, true);
  assert.equal(comparableCompanyCalled, true);
  assert.equal(result.value.job.comparableCompanyResearch.invoked, true);
  assert.equal(result.value.job.quality.metrics.competitorCount, 1);
  assert.ok(result.value.job.sources[0].retrievedAt);
  assert.equal(Object.keys(result.value.job.checkpoints).length, pipeline.steps.length);
  assert.equal(pipeline.steps.some((step) => step.key === "business-audit"), true);
  assert.equal(pipeline.steps.some((step) => step.key === "investment-analysis"), true);
  assert.match(report, /## 关键声明核查表/);
  assert.equal(storedPdf, "", "PDF should be rendered lazily on first download");
  assert.equal(result.value.job.pdfStoragePath, "");
  assert.equal(events.some((event) => event.type === "report_delta"), true);
  assert.equal(events.some((event) => event.type === "report_complete"), true);
  const finalStageIndex = events.findIndex((event) => event.type === "stage" && event.data.key === "persist-report" && event.data.status === "completed");
  const reportCompleteIndex = events.findIndex((event) => event.type === "report_complete");
  assert.ok(finalStageIndex >= 0);
  assert.ok(reportCompleteIndex > finalStageIndex, "report_complete must be emitted after the final stage is completed");
  assert.ok(saved.length >= pipeline.steps.length);
});

test("BP review identifies the company name when the user leaves it blank", async () => {
  let finalJob;
  const repository = {
    save: async (job) => { finalJob = job; return job; },
    saveReport: async () => {}
  };
  const model = {
    complete: async () => JSON.stringify({ companyProfile: { companyName: "材料识别科技", companyNameConfidence: "high", companyNameEvidence: ["封面公司名称"] }, claims: [], risks: [], searchQueries: [], missingInformation: [] }),
    webSearch: async () => [],
    stream: async (_messages, { onDelta }) => {
      const report = `# 报告\n\n${REPORT_SECTIONS.map((section) => `## ${section}\n\n内容`).join("\n\n")}${"补充内容".repeat(200)}`;
      onDelta(report);
      return report;
    }
  };
  const extractor = { extract: async () => Result.ok({ text: "材料识别科技有限公司商业计划书", pageCount: 1, originalChars: 16 }) };
  const pipeline = createBpReviewPipeline({ extractor, model, repository, evidenceVerificationService });
  const job = createReviewJob({ companyName: "", instruction: "", upload: { filename: "bp.pdf", data: "eA==" }, steps: pipeline.steps });
  const result = await pipeline.execute(job);
  assert.equal(result.ok, true, result.error);
  assert.equal(finalJob.companyName, "材料识别科技");
  assert.equal(finalJob.title, "材料识别科技 BP 核查");
});

test("BP review never adopts the user's instruction as the detected company name", async () => {
  let finalJob;
  const repository = {
    save: async (job) => { finalJob = job; return job; },
    saveReport: async () => {}
  };
  const model = {
    complete: async () => JSON.stringify({
      companyProfile: { companyName: "给我深入核查", companyNameConfidence: "high", companyNameEvidence: ["用户要求"] },
      claims: [], risks: [], searchQueries: [], missingInformation: []
    }),
    stream: async (_messages, { onDelta }) => {
      const report = `# 报告\n\n${REPORT_SECTIONS.map((section) => `## ${section}\n\n资料不足，分析推断需继续核实。`).join("\n\n")}${"补充说明。".repeat(220)}`;
      onDelta(report);
      return report;
    }
  };
  const extractor = { extract: async () => Result.ok({ text: "Alphabet Company Report", pageCount: 1, originalChars: 23 }) };
  const pipeline = createBpReviewPipeline({ extractor, model, repository, evidenceVerificationService, webResearchEnabled: false });
  const job = createReviewJob({ companyName: "", instruction: "给我深入核查", upload: { filename: "report.pdf", data: "eA==" }, steps: pipeline.steps });
  const result = await pipeline.execute(job);
  assert.equal(result.ok, true, result.error);
  assert.equal(finalJob.companyName, "");
  assert.equal(finalJob.companyIdentity.confidence, "low");
});

test("BP review replaces a stale provided company when the BP identifies a different subject", async () => {
  let finalJob;
  const repository = {
    save: async (job) => { finalJob = job; return job; },
    saveReport: async () => {}
  };
  const model = {
    complete: async () => JSON.stringify({
      companyProfile: {
        companyName: "三向纪元",
        companyNameConfidence: "high",
        companyNameEvidence: ["封面：三向纪元 | TriVera"],
        providedCompanyNameMatch: false
      },
      claims: [], risks: [], searchQueries: [], missingInformation: []
    }),
    stream: async (_messages, { onDelta }) => {
      const report = `# 报告\n\n${REPORT_SECTIONS.map((section) => `## ${section}\n\n资料不足，分析推断需继续核实。`).join("\n\n")}${"补充说明。".repeat(220)}`;
      onDelta(report);
      return report;
    }
  };
  const extractor = { extract: async () => Result.ok({ text: "三向纪元 | TriVera 商业计划书", pageCount: 1, originalChars: 24 }) };
  const pipeline = createBpReviewPipeline({ extractor, model, repository, evidenceVerificationService, webResearchEnabled: false });
  const job = createReviewJob({ companyName: "珠海纳甘新能源技术有限公司", instruction: "全面核查", upload: { filename: "bp.pdf", data: "eA==" }, steps: pipeline.steps });
  const result = await pipeline.execute(job);
  assert.equal(result.ok, true, result.error);
  assert.equal(finalJob.companyName, "三向纪元");
  assert.equal(finalJob.companyIdentity.providedNameMatch, false);
  assert.match(finalJob.companyIdentity.warning, /不一致/);
});

test("short model output produces a recoverable report instead of interrupting", async () => {
  let report = "";
  let finalJob;
  const repository = {
    save: async (job) => { finalJob = job; return job; },
    saveReport: async (_id, markdown) => { report = markdown; }
  };
  const model = {
    complete: async () => JSON.stringify({
      companyProfile: { companyName: "韧性科技", oneLiner: "测试项目" },
      claims: [{ domain: "客户", statement: "已有客户", bpEvidence: "第3页" }],
      risks: [],
      searchQueries: [],
      missingInformation: ["客户合同"]
    }),
    stream: async () => ""
  };
  const extractor = { extract: async () => Result.ok({ text: "韧性科技 BP", pageCount: 1, originalChars: 8 }) };
  const pipeline = createBpReviewPipeline({ extractor, model, repository, evidenceVerificationService });
  const job = createReviewJob({ companyName: "", instruction: "", upload: { filename: "bp.pdf", data: "eA==" }, steps: pipeline.steps });
  const result = await pipeline.execute(job);
  assert.equal(result.ok, true, result.error);
  assert.equal(finalJob.status, "needs_attention");
  assert.match(finalJob.generationWarning, /长报告输出异常/);
  assert.match(report, /## 关键声明核查表/);
  assert.ok(report.length > 300);
});

test("invalid structured JSON falls back and continues to a visible report", async () => {
  let finalJob;
  let report = "";
  const repository = {
    save: async (job) => { finalJob = job; return job; },
    saveReport: async (_id, markdown) => { report = markdown; }
  };
  const model = {
    complete: async () => "这不是 JSON",
    stream: async (_messages, { onDelta }) => {
      const value = `# 报告\n\n${REPORT_SECTIONS.map((section) => `## ${section}\n\n资料不足，需结合 BP 原文复核。`).join("\n\n")}${"补充说明。".repeat(200)}`;
      onDelta(value);
      return value;
    }
  };
  const extractor = { extract: async () => Result.ok({ text: "降级科技商业计划书", pageCount: 2, originalChars: 10 }) };
  const pipeline = createBpReviewPipeline({ extractor, model, repository, evidenceVerificationService, webResearchEnabled: false });
  const job = createReviewJob({ companyName: "降级科技", instruction: "全面核查", upload: { filename: "bp.pdf", data: "eA==" }, steps: pipeline.steps });
  const result = await pipeline.execute(job);
  assert.equal(result.ok, true, result.error);
  assert.equal(finalJob.status, "needs_attention");
  assert.match(finalJob.extractionWarning, /连续两次格式异常/);
  assert.ok(report.length > 300);
});
