import test from "node:test";
import assert from "node:assert/strict";
import { renderQualitySummary } from "../public/quality-summary.js";

test("quality summary exposes verified citation and traceable BP counts", () => {
  const classes = new Set(["hidden"]);
  const container = {
    innerHTML: "",
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      }
    }
  };
  renderQualitySummary(container, {
    metrics: { verifiedCitationCount: 3, traceableDocumentClaimCount: 2 },
    findings: []
  });
  assert.match(container.innerHTML, /已核验引用 3/);
  assert.match(container.innerHTML, /可追溯 BP 声明 2/);
  assert.equal(classes.has("hidden"), false);
});
