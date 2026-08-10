import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildEvidenceRefreshMarkup, isEvidenceRefreshActive } from "../public/evidence-refresh-ui.js";

const source = await readFile(new URL("../public/evidence-refresh-ui.js", import.meta.url), "utf8");

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

test("evidence refresh keeps one stable card and patches stage nodes", () => {
  assert.equal(Array.from(source.matchAll(/container\.append\(card\)/g)).length, 1);
  assert.equal(Array.from(source.matchAll(/card\.innerHTML\s*=/g)).length, 1);
  assert.match(source, /patchRefreshStages/);
  const markup = buildEvidenceRefreshMarkup({
    refresh: { status: "running", steps: [{ key: "refresh-search", label: "搜索", status: "unexpected", message: "检索中" }] }
  });
  assert.match(markup, /data-refresh-stage-key="refresh-search"/);
  assert.match(markup, /class="refresh-stage pending"/);
});
