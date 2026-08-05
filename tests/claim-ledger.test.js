import test from "node:test";
import assert from "node:assert/strict";
import { buildClaimLedger } from "../src/domain/claim-ledger.js";

test("claim ledger distinguishes support, conflict and BP-only claims", () => {
  const ledger = buildClaimLedger({
    claims: [
      { id: "c1", domain: "客户", statement: "已有十家客户", bpEvidence: "第5页", importance: "high" },
      { id: "c2", domain: "收入", statement: "收入增长三倍", bpEvidence: "第8页", importance: "critical" },
      { id: "c3", domain: "市场", statement: "市场规模百亿元", bpEvidence: "第10页", importance: "medium" }
    ],
    sources: [
      { id: "source_1", title: "客户公告", url: "https://example.com/customer", snippet: "确认采购", sourceTier: "primary", supports: ["c1"], conflicts: [] },
      { id: "source_2", title: "公开财报", url: "https://example.com/filing", snippet: "披露收入下降", sourceTier: "primary", supports: [], conflicts: ["c2"] }
    ],
    coverage: [
      { claimId: "c1", status: "supported", supportedBy: ["source_1"], conflictedBy: [], candidates: [] },
      { claimId: "c2", status: "conflicted", supportedBy: [], conflictedBy: ["source_2"], candidates: [] }
    ]
  });
  assert.deepEqual(ledger.claims.map((item) => item.status), ["supported", "conflicted", "bp_only"]);
  assert.equal(ledger.claims[0].confidence, "high");
  assert.equal(ledger.summary.supported, 1);
  assert.equal(ledger.summary.conflicted, 1);
  assert.equal(ledger.summary.bpOnly, 1);
});

test("claim ledger marks overlapping but unconfirmed evidence as a candidate", () => {
  const ledger = buildClaimLedger({
    claims: [{ id: "c1", statement: "产品进入二期临床", bpEvidence: "第4页", importance: "high" }],
    sources: [{ id: "source_1", title: "试验登记", url: "https://example.com/trial", snippet: "二期临床", sourceTier: "secondary" }],
    coverage: [{ claimId: "c1", status: "candidate", supportedBy: [], conflictedBy: [], candidates: ["source_1"] }]
  });
  assert.equal(ledger.claims[0].status, "candidate");
  assert.equal(ledger.claims[0].candidateSources.length, 1);
  assert.equal(ledger.summary.highPriorityOpen, 1);
});
