import test from "node:test";
import assert from "node:assert/strict";
import { buildWebSearchQueries, shouldUseWebSearch } from "../src/domain/followup-research-plan.js";

test("follow-up research planning detects fresh-data questions and keeps linked URLs", () => {
  assert.equal(shouldUseWebSearch("查一下最新融资"), true);
  assert.equal(shouldUseWebSearch("报告里的收入是多少"), false);
  assert.deepEqual(buildWebSearchQueries("核查 https://example.com/a"), ["https://example.com/a", "核查 https://example.com/a"]);
});
