import test from "node:test";
import assert from "node:assert/strict";
import { createReviewManagerService } from "../src/domain/review-manager-service.js";

test("review manager hides jobs, reports, and owner identifiers across browsers", async () => {
  const ownerA = `anon_${"a".repeat(43)}`;
  const ownerB = `anon_${"b".repeat(43)}`;
  const jobs = new Map([
    ["bp_owner_a", { id: "bp_owner_a", ownerId: ownerA, status: "completed", reportAvailable: true, checkpoints: {}, upload: { filename: "a.pdf" } }],
    ["bp_owner_b", { id: "bp_owner_b", ownerId: ownerB, status: "completed", reportAvailable: true, checkpoints: {}, upload: { filename: "b.pdf" } }]
  ]);
  const repository = {
    claimUnowned: async () => 0,
    get: async (id) => jobs.get(id) || null,
    getReport: async (id) => `report:${id}`,
    list: async ({ ownerId }) => Array.from(jobs.values()).filter((job) => job.ownerId === ownerId),
    save: async (job) => { jobs.set(job.id, job); return job; }
  };
  const manager = createReviewManagerService({ pipeline: { steps: [], execute: async () => ({ ok: true }) }, repository, model: {} });
  const list = await manager.list({ ownerId: ownerA });
  assert.deepEqual(list.map((job) => job.id), ["bp_owner_a"]);
  assert.equal("ownerId" in list[0], false);
  assert.equal((await manager.get("bp_owner_a", { ownerId: ownerA })).report, "report:bp_owner_a");
  await assert.rejects(
    manager.get("bp_owner_b", { ownerId: ownerA }),
    (error) => error.statusCode === 404 && /未找到/.test(error.message)
  );
});

test("legacy unowned job is claimed by the first browser that opens it", async () => {
  const ownerId = `anon_${"d".repeat(43)}`;
  let job = { id: "bp_legacy", status: "completed", reportAvailable: false, checkpoints: {}, upload: { filename: "legacy.pdf" } };
  const repository = {
    get: async () => job,
    getReport: async () => "",
    save: async (value) => { job = value; return value; }
  };
  const manager = createReviewManagerService({ pipeline: { steps: [] }, repository, model: {} });
  const result = await manager.get("bp_legacy", { ownerId });
  assert.equal(result.id, "bp_legacy");
  assert.equal(job.ownerId, ownerId);
  assert.equal("ownerId" in result, false);
});

test("reanalyze archives the visible report and resets checkpoints while retaining ownership", async () => {
  const ownerId = `anon_${"e".repeat(43)}`;
  let job = {
    id: "bp_reanalyze",
    ownerId,
    status: "completed",
    reportAvailable: true,
    checkpoints: { old: { completed: true } },
    stages: [],
    upload: { filename: "watermarked.pdf", persisted: true }
  };
  let archived = false;
  const repository = {
    archiveReport: async () => { archived = true; return "/archive/report.md"; },
    get: async () => job,
    getUpload: async () => Buffer.from("pdf"),
    save: async (value) => { job = value; return value; }
  };
  const pipeline = { steps: [{ key: "document-parse", label: "解析" }], execute: async () => ({ ok: true }) };
  const manager = createReviewManagerService({ pipeline, repository, model: {} });
  const result = await manager.reanalyze("bp_reanalyze", { ownerId });
  assert.equal(archived, true);
  assert.equal(result.status, "running");
  assert.equal(result.reanalysisInProgress, true);
  assert.equal(result.checkpointCount, 0);
  assert.equal("previousReportArchive" in result, false);
  assert.equal(job.ownerId, ownerId);
});

test("retry clears stale failure metadata before resuming from checkpoints", async () => {
  const ownerId = `anon_${"r".repeat(43)}`;
  let job = { id: "bp_retry", ownerId, status: "needs_attention", error: "font error", failedStep: "persist-report", checkpoints: {}, stages: [] };
  const repository = {
    get: async () => job,
    save: async (value) => { job = value; return value; }
  };
  const pipeline = { steps: [], execute: async () => ({ ok: true }) };
  const manager = createReviewManagerService({ pipeline, repository, model: {} });
  const result = await manager.retry("bp_retry", { ownerId });
  assert.equal(result.status, "running");
  assert.equal(job.error, "");
  assert.equal(job.failedStep, "");
});

test("Scholar URL follow-up uses DeepSeek WebSearch before answering", async () => {
  const ownerId = `anon_${"s".repeat(43)}`;
  const scholarUrl = "https://scholar.google.com/citations?user=SLyWFgYAAAAJ&hl=en";
  let job = { id: "bp_scholar", ownerId, companyName: "精碳源", status: "completed", reportAvailable: true, checkpoints: {}, messages: [] };
  let searchedQueries = [];
  let streamedMessages = [];
  const repository = {
    get: async () => job,
    getReport: async () => "# 核查报告",
    save: async (value) => { job = value; return value; }
  };
  const model = {
    webSearch: async ({ queries }) => {
      searchedQueries = queries;
      return [{ title: "Junze CHEN", url: scholarUrl, snippet: "Sichuan University" }];
    },
    stream: async (messages, { onDelta }) => {
      streamedMessages = messages;
      onDelta("检索完成");
      return "检索完成";
    }
  };
  const statuses = [];
  const manager = createReviewManagerService({ pipeline: { steps: [] }, repository, model });
  const answer = await manager.ask("bp_scholar", `核查 ${scholarUrl}`, {
    ownerId,
    onStatus: (value) => statuses.push(value),
    onDelta: () => {}
  });
  assert.equal(answer, "检索完成");
  assert.equal(searchedQueries[0], scholarUrl);
  assert.match(statuses[0], /AI 判断需要补充检索/);
  assert.match(JSON.stringify(streamedMessages), /Sichuan University/);
});

test("deleting a conversation archives it while retaining its upload", async () => {
  const ownerId = `anon_${"x".repeat(43)}`;
  let job = { id: "bp_delete_test", ownerId, status: "completed", reportAvailable: true, checkpoints: {}, upload: { storagePath: "20260804/bp_delete_test.source" } };
  let archived = false;
  const repository = {
    get: async () => job,
    archiveConversation: async () => { archived = true; job = null; return { archived: true, uploadRetained: true, pdfRetained: true }; }
  };
  const manager = createReviewManagerService({ pipeline: { steps: [] }, repository, model: {} });
  const result = await manager.deleteConversation("bp_delete_test", { ownerId });
  assert.equal(archived, true);
  assert.equal(result.uploadRetained, true);
  assert.equal(result.pdfRetained, true);
  await assert.rejects(manager.get("bp_delete_test", { ownerId }), (error) => error.statusCode === 404);
});

test("AI decides whether a follow-up needs Agentic Search", async () => {
  const ownerId = `anon_${"p".repeat(43)}`;
  let webSearchCalls = 0;
  let job = { id: "bp_plan_test", ownerId, companyName: "示例公司", status: "completed", reportAvailable: true, checkpoints: {}, messages: [] };
  const repository = {
    get: async () => job,
    getReport: async () => "报告已经包含收入为 100 万元",
    save: async (value) => { job = value; return value; }
  };
  const model = {
    planFollowupResearch: async () => ({ needsSearch: false, reason: "报告已有答案", tools: [], queries: [] }),
    webSearch: async () => { webSearchCalls += 1; return []; },
    stream: async () => "根据现有报告，收入为 100 万元。"
  };
  const manager = createReviewManagerService({ pipeline: { steps: [] }, repository, model });
  const answer = await manager.ask("bp_plan_test", "报告里的收入是多少？", { ownerId });
  assert.match(answer, /100 万元/);
  assert.equal(webSearchCalls, 0);
});
