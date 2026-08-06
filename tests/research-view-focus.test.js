import test from "node:test";
import assert from "node:assert/strict";
import { focusResearchStart } from "../public/research-view-focus.js";

test("research restart moves keyboard and scroll focus to the progress card", () => {
  const calls = [];
  const conversation = {
    scrollTop: 640,
    getBoundingClientRect: () => ({ top: 100 }),
    scrollTo: (options) => calls.push(["scroll", options])
  };
  const progressPanel = {
    getBoundingClientRect: () => ({ top: 220 }),
    setAttribute: (...values) => calls.push(["attribute", ...values]),
    focus: (options) => calls.push(["focus", options])
  };

  assert.equal(focusResearchStart({ conversation, progressPanel, schedule: (callback) => callback() }), true);
  assert.deepEqual(calls, [
    ["attribute", "tabindex", "-1"],
    ["focus", { preventScroll: true }],
    ["scroll", { top: 736, behavior: "smooth" }]
  ]);
});

test("research focus is a safe no-op before the progress card exists", () => {
  assert.equal(focusResearchStart({ conversation: {}, progressPanel: null }), false);
});
