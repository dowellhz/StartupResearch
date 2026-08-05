import test from "node:test";
import assert from "node:assert/strict";
import { requestJson } from "../public/http-client.js";

test("read requests retry one transient network failure", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  assert.deepEqual(await requestJson("/api/health", {}, fetchImpl), { ok: true });
  assert.equal(calls, 2);
});

test("write requests are not automatically repeated", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new TypeError("Failed to fetch"); };
  await assert.rejects(requestJson("/api/reviews", { method: "POST" }, fetchImpl), /暂时无法连接本地服务/);
  assert.equal(calls, 1);
});
