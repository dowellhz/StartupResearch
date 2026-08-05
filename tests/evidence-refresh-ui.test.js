import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceRefreshMarkup, isEvidenceRefreshActive } from "../public/evidence-refresh-ui.js";

test("evidence refresh UI renders safe progress and a Markdown change report", () => {
  const live = buildEvidenceRefreshMarkup({
    refresh: { status: "running", steps: [{ label: "<script>alert(1)</script>", status: "running", message: "检索中" }] }
  });
  assert.equal(isEvidenceRefreshActive({ status: "running" }), true);
  assert.match(live, /LIVE/);
  assert.doesNotMatch(live, /<script>/);
  const done = buildEvidenceRefreshMarkup({
    refresh: { status: "completed", steps: [] },
    result: { status: "completed", report: "# 变化报告\n\n## 新增来源\n\n- 已形成证据" }
  });
  assert.match(done, /公开资料变化报告/);
  assert.match(done, /<h1>变化报告<\/h1>/);
});
