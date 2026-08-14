import test from "node:test";
import assert from "node:assert/strict";
import { createSemanticOverclaimService } from "../src/domain/semantic-overclaim-service.js";

test("semantic overclaim review returns bounded evidence-aware findings", async () => {
  const model = { complete: async () => JSON.stringify({ findings: [{ statement: "该公司必然成为第一", reason: "证据仅支持增长，不能支持必然性", severity: "high", sourceIds: ["source_1", "invented"] }] }) };
  const service = createSemanticOverclaimService({ model });
  const result = await service.check({ report: "该公司必然成为第一", evidenceManifest: { citations: [{ sourceId: "source_1" }] } });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings[0].sourceIds, ["source_1"]);
});

test("semantic review failure degrades to a warning without blocking output", async () => {
  const service = createSemanticOverclaimService({ model: { complete: async () => { throw new Error("provider detail"); } } });
  const result = await service.check({ report: "报告" });
  assert.equal(result.ok, true);
  assert.match(result.warning, /未完成/);
  assert.doesNotMatch(result.warning, /provider/);
});
