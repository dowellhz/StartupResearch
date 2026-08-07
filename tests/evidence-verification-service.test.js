import test from "node:test";
import assert from "node:assert/strict";
import {
  createEvidenceVerificationService,
  findNormalizedQuote,
  parseDocumentEvidence,
  verifyDocumentCitation
} from "../src/infra/evidence-verification-service.js";

test("document citation verifies an exact quote on the cited page", () => {
  const citation = verifyDocumentCitation({
    claimId: "claim_1",
    evidence: { pageNumber: 2, exactQuote: "累计服务  10 家核心客户" },
    document: {
      filename: "bp.pdf",
      pages: [
        { page: 1, text: "公司介绍" },
        { page: 2, text: "截至目前，累计服务 10 家核心客户，续约率持续提升。" }
      ]
    }
  });
  assert.equal(citation.verificationStatus, "verified");
  assert.equal(citation.pageNumber, 2);
  assert.equal(citation.matchMethod, "normalized_exact");
  assert.ok(citation.charStart >= 0);
  assert.ok(citation.charEnd > citation.charStart);
  assert.match(citation.evidenceHash, /^[a-f0-9]{64}$/);
});

test("document citation corrects a wrong model supplied page number", () => {
  const citation = verifyDocumentCitation({
    evidence: { pageNumber: 3, exactQuote: "已完成种子轮融资" },
    document: {
      filename: "bp.pdf",
      pages: [
        { page: 1, text: "公司已完成种子轮融资，资金用于产品研发。" },
        { page: 3, text: "市场分析" }
      ]
    }
  });
  assert.equal(citation.verificationStatus, "page_corrected");
  assert.equal(citation.pageNumber, 1);
});

test("manifest keeps search snippets captured and trusts only fetched page bodies", () => {
  const service = createEvidenceVerificationService();
  const manifest = service.buildManifest({
    now: "2026-08-07T10:00:00.000Z",
    claims: [{
      id: "claim_1",
      importance: "high",
      bpEvidence: { pageNumber: 1, exactQuote: "公司已实现产品量产" }
    }],
    document: { filename: "bp.pdf", pages: [{ page: 1, text: "公司已实现产品量产，并开始交付。" }] },
    coverage: [{ claimId: "claim_1", supportedBy: ["source_1"], candidates: ["source_2"] }],
    sources: [
      { id: "source_1", url: "https://example.com/a", snippet: "官网显示产品已交付", verificationStatus: "verified", contentHash: "a".repeat(64) },
      { id: "source_2", url: "https://example.com/b", snippet: "搜索结果提及产品", verificationStatus: "captured" }
    ]
  });
  assert.equal(manifest.quality.ok, true);
  assert.equal(manifest.summary.verifiedCitations, 2);
  assert.equal(manifest.summary.capturedWebCitations, 1);
  assert.deepEqual(manifest.claims[0].webCitations.map((item) => item.verificationStatus), ["verified", "captured"]);
});

test("high priority claims without a verbatim BP quote fail the evidence trust gate", () => {
  const service = createEvidenceVerificationService();
  const manifest = service.buildManifest({
    claims: [{ id: "claim_1", importance: "critical", bpEvidence: "第 8 页" }],
    document: { filename: "bp.pdf", pages: [{ page: 8, text: "收入数据" }] }
  });
  assert.equal(manifest.quality.ok, false);
  assert.equal(manifest.summary.openHighPriorityDocumentCitations, 1);
  assert.equal(manifest.claims[0].documentCitation.verificationStatus, "unverified");
});

test("legacy evidence strings retain page location but do not invent quotes", () => {
  assert.deepEqual(parseDocumentEvidence("第 12 页"), { pageNumber: 12, exactQuote: "", location: "第 12 页" });
  assert.deepEqual(parseDocumentEvidence("Page 4，原文：\"Annual recurring revenue reached RMB 20 million.\""), {
    pageNumber: 4,
    exactQuote: "Annual recurring revenue reached RMB 20 million.",
    location: "Page 4，原文：\"Annual recurring revenue reached RMB 20 million.\""
  });
});

test("normalized quote matching returns offsets in original text", () => {
  const text = "收入为  RMB ２０ million。";
  const match = findNormalizedQuote(text, "RMB 20 million");
  assert.equal(text.slice(match.start, match.end), "RMB ２０ million");
});
