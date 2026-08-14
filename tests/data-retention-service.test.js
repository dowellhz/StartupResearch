import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDataRetentionService } from "../src/storage/data-retention-service.js";
import { createFileReviewRepository } from "../src/storage/file-review-repository.js";

test("retention moves expired terminal data to a recoverable grace directory", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "venture-retention-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const repository = createFileReviewRepository({ dataDir, now: () => "2026-07-01T00:00:00Z" });
  await repository.save({ id: "bp_retention", ownerId: "owner", status: "completed", createdAt: "2026-06-01T00:00:00Z", upload: {} });
  await repository.saveReport("bp_retention", "report");
  const service = createDataRetentionService({ dataDir, repository, retentionDays: 30, graceDays: 7, now: () => new Date("2026-08-14T00:00:00Z") });
  const result = await service.cleanup();
  assert.equal(result.archivedJobs, 1);
  assert.equal(await repository.get("bp_retention"), null);
  assert.equal(await readFile(path.join(dataDir, "retention-trash", "20260814", "bp_retention", "report.md"), "utf8"), "report");
});

test("retention is disabled unless explicitly configured", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "venture-retention-off-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await mkdir(path.join(dataDir, "jobs"), { recursive: true });
  await writeFile(path.join(dataDir, "jobs", "bp_keep.json"), "{}", "utf8");
  const result = await createDataRetentionService({ dataDir, repository: {}, retentionDays: 0 }).cleanup();
  assert.equal(result.enabled, false);
});
