import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceAssessment, classifySourceTier, normalizeEvidenceSources } from "../src/domain/research-evidence-service.js";

test("evidence sources merge duplicate URLs and preserve richer cited text", () => {
  const sources = normalizeEvidenceSources([
    { title: "Example", url: "https://clinicaltrials.gov/study/NCT00000001", snippet: "" },
    { title: "Official trial", url: "https://clinicaltrials.gov/study/NCT00000001", citedText: "The trial is recruiting participants.", supports: ["claim_1"], provider: "ClinicalTrials.gov" }
  ]);
  assert.equal(sources.length, 1);
  assert.match(sources[0].snippet, /recruiting/);
  assert.deepEqual(sources[0].supports, ["claim_1"]);
  assert.equal(sources[0].sourceTier, "primary");
  assert.equal(sources[0].provider, "ClinicalTrials.gov");
});

test("evidence sources retain linked-page provenance", () => {
  const sources = normalizeEvidenceSources([{
    title: "Team",
    url: "https://example.com/team",
    snippet: "Official team profile with public research experience.",
    discoveredFrom: "https://example.com/",
    depth: 1,
    contentType: "text/html",
    verificationStatus: "verified",
    contentHash: "a".repeat(64),
    provider: "页面二级发现"
  }]);
  assert.equal(sources[0].depth, 1);
  assert.equal(sources[0].discoveredFrom, "https://example.com/");
  assert.equal(sources[0].contentType, "text/html");
  assert.equal(sources[0].verificationStatus, "verified");
  assert.equal(sources[0].contentHash, "a".repeat(64));
});

test("a richer search excerpt does not inherit verification from another snippet", () => {
  const sources = normalizeEvidenceSources([
    { url: "https://example.com/a", snippet: "已抓取正文", verificationStatus: "verified", contentHash: "a".repeat(64) },
    { url: "https://example.com/a", snippet: "搜索摘要提供了更长但未经正文抓取验证的证据片段", verificationStatus: "captured" }
  ]);
  assert.equal(sources[0].verificationStatus, "captured");
  assert.equal(sources[0].contentHash, "");
});

test("evidence assessment reports claim coverage instead of counting URLs", () => {
  const assessment = buildEvidenceAssessment({
    claims: [{ id: "claim_1", importance: "critical", statement: "产品已进入二期临床试验" }],
    sources: [{ title: "Official trial", url: "https://clinicaltrials.gov/study/NCT00000001", snippet: "产品已进入二期临床试验并正在招募", supports: ["claim_1"] }]
  });
  assert.equal(assessment.metrics.sourceCount, 1);
  assert.equal(assessment.metrics.evidenceRichCount, 1);
  assert.equal(assessment.metrics.claimCoverageRatio, 1);
  assert.equal(assessment.coverage[0].status, "supported");
});

test("source authority distinguishes primary records from research leads", () => {
  assert.equal(classifySourceTier("https://www.sec.gov/Archives/example"), "primary");
  assert.equal(classifySourceTier("https://baike.baidu.com/item/example"), "lead");
  assert.equal(classifySourceTier("https://www.reuters.com/example"), "secondary");
});
