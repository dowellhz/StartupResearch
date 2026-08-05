import test from "node:test";
import assert from "node:assert/strict";
import { createEvidenceRefreshService } from "../src/domain/evidence-refresh-service.js";

function baseJob() {
  return {
    id: "bp_refresh_test",
    companyName: "刷新科技",
    analysis: {
      claims: [{ id: "c1", domain: "客户", statement: "已有十家客户", importance: "high", bpEvidence: "第5页" }]
    },
    researchPlan: {
      searchQueries: Array.from({ length: 12 }, (_, index) => `刷新科技 查询 ${index}`),
      verificationPacks: [{ query: "刷新科技 客户 官网" }],
      requestedTools: ["general_web_search"]
    },
    sources: [{ title: "旧公司页", url: "https://example.com/company", snippet: "旧页面仅介绍产品", supports: [] }],
    claimLedger: { claims: [{ id: "c1", status: "bp_only" }] },
    evidenceRefreshHistory: []
  };
}

test("manual evidence refresh is budgeted, checkpointed, and persists an evidence delta", async () => {
  const saves = [];
  const repository = { save: async (job) => { const saved = structuredClone(job); saves.push(saved); return saved; } };
  const model = {
    webSearch: async ({ queries }) => {
      assert.ok(queries.length <= 8);
      return [
        { title: "公司客户公告", url: "https://example.com/company", snippet: "公司公告披露已有十家客户", supports: ["c1"] },
        { title: "客户官网", url: "https://customer.example/news", snippet: "客户官网确认与刷新科技合作", supports: ["c1"] }
      ];
    },
    complete: async () => JSON.stringify({
      summary: "新增客户合作证据，但不代表合作刚刚发生。",
      materialChanges: [{ changeType: "new_evidence", category: "客户", title: "客户合作获得公开支持", description: "客户官网出现合作信息", impact: "降低客户真实性不确定性", severity: "medium", sourceIds: ["source_2", "invented"] }],
      watchItems: ["继续核验合同金额与回款"]
    })
  };
  const service = createEvidenceRefreshService({ model, repository, now: () => "2026-08-05T12:00:00.000Z" });
  const job = { ...baseJob(), evidenceRefresh: service.createRefresh() };
  const events = [];
  const result = await service.execute(job, { onEvent: (event) => events.push(event) });
  assert.equal(result.ok, true, result.error);
  const finalJob = result.value.job;
  assert.equal(finalJob.evidenceRefresh.status, "completed");
  assert.equal(Object.keys(finalJob.evidenceRefresh.checkpoints).length, 4);
  assert.equal(finalJob.sources.length, 2);
  assert.equal(finalJob.claimLedger.claims[0].status, "supported");
  assert.equal(finalJob.lastEvidenceRefresh.counts.addedSourceCount, 1);
  assert.equal(finalJob.lastEvidenceRefresh.counts.refreshedSourceCount, 1);
  assert.equal(finalJob.lastEvidenceRefresh.materialChanges[0].sourceIds.includes("invented"), false);
  assert.match(finalJob.lastEvidenceRefresh.report, /客户官网/);
  assert.ok(events.some((event) => event.type === "refresh_complete"));
  assert.ok(saves.length >= 6);
});

test("a failed refresh search preserves the prior evidence and produces a visible warning report", async () => {
  let completeCalls = 0;
  const repository = { save: async (job) => structuredClone(job) };
  const model = {
    webSearch: async () => { throw new Error("search unavailable"); },
    complete: async () => { completeCalls += 1; return "{}"; }
  };
  const service = createEvidenceRefreshService({ model, repository });
  const job = { ...baseJob(), evidenceRefresh: service.createRefresh() };
  const result = await service.execute(job);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.value.job.evidenceRefresh.status, "needs_attention");
  assert.equal(result.value.job.sources.length, 1);
  assert.equal(completeCalls, 0);
  assert.match(result.value.job.lastEvidenceRefresh.report, /旧证据已完整保留/);
  assert.equal(result.value.job.lastEvidenceRefresh.counts.addedSourceCount, 0);
});
