import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJsonlLogger } from "../src/infra/jsonl-logger.js";

test("structured audit logs hash owners and redact sensitive payload fields", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "venture-logs-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const sink = { write: () => {} };
  const logger = createJsonlLogger({ dataDir, now: () => "2026-08-14T12:00:00.000Z", stdout: sink, stderr: sink });
  await logger.audit("review.created", { ownerId: "anon-secret-owner", jobId: "bp_123456", report: "sensitive report" });
  const record = JSON.parse(await readFile(path.join(dataDir, "logs", "audit-20260814.jsonl"), "utf8"));
  assert.equal(record.event, "review.created");
  assert.equal(record.report, "[redacted]");
  assert.notEqual(record.owner, "anon-secret-owner");
});
