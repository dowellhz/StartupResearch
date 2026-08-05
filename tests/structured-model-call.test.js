import test from "node:test";
import assert from "node:assert/strict";
import { completeStructuredJson } from "../src/domain/structured-model-call.js";

test("structured model calls repair one invalid JSON response before failing the workflow", async () => {
  let calls = 0;
  const retries = [];
  const model = {
    complete: async () => {
      calls += 1;
      return calls === 1 ? "不是 JSON" : '{"claims":[]}';
    }
  };
  const result = await completeStructuredJson({ model, messages: [], validate: (value) => value, onRetry: (value) => retries.push(value) });
  assert.deepEqual(result, { claims: [] });
  assert.equal(calls, 2);
  assert.equal(retries.length, 1);
});
