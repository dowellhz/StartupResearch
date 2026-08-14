import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { publicError } from "../src/infra/public-error.js";
import { acquireProcessLease } from "../src/infra/process-lease.js";
import { createRateLimiter, requestClientKey } from "../src/infra/rate-limiter.js";
import { createFileUsageBudget } from "../src/storage/file-usage-budget.js";

test("internal errors are hidden while operational errors remain actionable", () => {
  assert.deepEqual(publicError(new Error("/private/path secret dependency"), { requestId: "req-1" }), {
    status: 500,
    body: { ok: false, error: "服务器暂时无法完成请求，请稍后重试", requestId: "req-1" }
  });
  const invalid = Object.assign(new Error("请求无效"), { statusCode: 400, code: "invalid" });
  assert.deepEqual(publicError(invalid), { status: 400, body: { ok: false, error: "请求无效", code: "invalid" } });
});

test("sliding-window rate limiter returns 429 and honors trusted proxy boundaries", () => {
  let now = 1000;
  const limiter = createRateLimiter({ windowMs: 1000, max: 2, now: () => now });
  limiter.consume("client");
  limiter.consume("client");
  assert.throws(() => limiter.consume("client"), (error) => error.statusCode === 429 && error.retryAfterSeconds === 1);
  now = 2001;
  assert.equal(limiter.consume("client").remaining, 1);
  const req = { headers: { "x-forwarded-for": "203.0.113.4, 127.0.0.1" }, socket: { remoteAddress: "127.0.0.1" } };
  assert.equal(requestClientKey(req), "127.0.0.1");
  assert.equal(requestClientKey(req, { trustProxy: true }), "203.0.113.4");
});

test("single-instance lease rejects a live owner and recovers after release", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "venture-lease-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const lease = await acquireProcessLease({ dataDir, pid: 4242, isAlive: (pid) => pid === 4242 });
  await assert.rejects(acquireProcessLease({ dataDir, pid: 4343, isAlive: (pid) => pid === 4242 }), /仅支持单实例/);
  await lease.release();
  const next = await acquireProcessLease({ dataDir, pid: 4343, isAlive: () => false });
  await next.release();
});

test("daily cost budget persists owner/global usage and supports rejected-request refunds", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "venture-budget-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const budget = createFileUsageBudget({ dataDir, ownerDailyLimit: 5, globalDailyLimit: 8, now: () => new Date("2026-08-14T00:00:00Z") });
  const receipt = await budget.consume("owner-a", 3);
  await assert.rejects(budget.consume("owner-a", 3), (error) => error.statusCode === 429);
  await budget.refund(receipt);
  await budget.consume("owner-a", 5);
  await budget.consume("owner-b", 3);
  await assert.rejects(budget.consume("owner-c", 1), (error) => error.code === "daily_budget_exceeded");
});
