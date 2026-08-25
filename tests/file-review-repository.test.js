import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createFileReviewRepository, formatUploadDate } from "../src/storage/file-review-repository.js";

test("uploads are stored below a YYYYMMDD directory", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "venture-lens-storage-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const repository = createFileReviewRepository({ dataDir, now: () => "2026-08-04T12:00:00+08:00" });
  const storagePath = await repository.saveUpload("bp_storage_test", Buffer.from("bp"));
  assert.equal(storagePath, "20260804/bp_storage_test.source");
  assert.equal(await readFile(path.join(dataDir, "uploads", storagePath), "utf8"), "bp");
  assert.equal((await repository.getUpload("bp_storage_test", storagePath)).toString(), "bp");
  await repository.save({ id: "bp_storage_test", status: "completed", upload: { storagePath } });
  await repository.saveReport("bp_storage_test", "report");
  const pdfStoragePath = await repository.savePdf("bp_storage_test", Buffer.from("pdf-result"));
  const archived = await repository.archiveConversation("bp_storage_test");
  assert.equal(archived.archived, true);
  assert.equal(archived.uploadRetained, true);
  assert.equal(archived.pdfRetained, true);
  assert.equal(await repository.get("bp_storage_test"), null);
  assert.equal(await repository.getReport("bp_storage_test"), "");
  assert.equal((await repository.getUpload("bp_storage_test", storagePath)).toString(), "bp");
  assert.equal((await repository.getPdf("bp_storage_test", pdfStoragePath)).toString(), "pdf-result");
});

test("upload dates use Asia Shanghai calendar days", () => {
  assert.equal(formatUploadDate("2026-08-03T16:30:00Z"), "20260804");
});

test("multi-file upload slots use separate dated paths", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "venture-lens-multi-storage-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const repository = createFileReviewRepository({ dataDir, now: () => "2026-08-26T01:00:00+08:00" });
  const first = await repository.saveUpload("bp_multi_storage", Buffer.from("one"), { slot: 0 });
  const second = await repository.saveUpload("bp_multi_storage", Buffer.from("two"), { slot: 1 });
  assert.equal(first, "20260826/bp_multi_storage-1.source");
  assert.equal(second, "20260826/bp_multi_storage-2.source");
  assert.equal((await repository.getUpload("bp_multi_storage", first)).toString(), "one");
  assert.equal((await repository.getUpload("bp_multi_storage", second)).toString(), "two");
});

test("Google login transfers anonymous jobs and protects the new owner from stale saves", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "venture-lens-owner-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const repository = createFileReviewRepository({ dataDir });
  const stale = await repository.save({ id: "bp_owner_transfer", ownerId: "anon_old", status: "running" });
  await repository.save({ id: "bp_other_owner", ownerId: "anon_other", status: "completed" });
  assert.equal(await repository.transferOwnership("anon_old", "google_owner"), 1);
  await repository.save({ ...stale, status: "completed" });
  assert.equal((await repository.get("bp_owner_transfer")).ownerId, "google_owner");
  assert.equal((await repository.get("bp_other_owner")).ownerId, "anon_other");
});

test("checkpoint artifacts are stored separately and transparently restored", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "venture-lens-artifacts-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const repository = createFileReviewRepository({ dataDir });
  await repository.save({
    id: "bp_artifact_test",
    ownerId: "owner-a",
    status: "running",
    checkpoints: { research: { completed: true, artifact: { sources: [{ snippet: "large evidence".repeat(100) }] } } }
  });
  const raw = JSON.parse(await readFile(path.join(dataDir, "jobs", "bp_artifact_test.json"), "utf8"));
  assert.match(raw.checkpoints.research.artifactPath, /artifacts|pipeline-research|bp_artifact/);
  assert.equal("artifact" in raw.checkpoints.research, false);
  const restored = await repository.get("bp_artifact_test");
  assert.match(restored.checkpoints.research.artifact.sources[0].snippet, /large evidence/);
});

test("indexed list reads only selected job files and legacy ownership requires explicit migration", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "venture-lens-index-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let at = 0;
  const repository = createFileReviewRepository({ dataDir, now: () => new Date(1_700_000_000_000 + at++ * 1000).toISOString() });
  await repository.save({ id: "bp_old_job", status: "completed", checkpoints: {} });
  await repository.save({ id: "bp_new_job", ownerId: "owner-a", status: "completed", checkpoints: {} });
  await writeFile(path.join(dataDir, "jobs", "bp_old_job.json"), "not-json", "utf8");
  assert.deepEqual((await repository.list({ limit: 1 })).map((job) => job.id), ["bp_new_job"]);
  assert.equal((await repository.list({ ownerId: "owner-a" })).length, 1);
  await writeFile(path.join(dataDir, "jobs", "bp_old_job.json"), JSON.stringify({ id: "bp_old_job", status: "completed", checkpoints: {} }), "utf8");
  assert.equal(await repository.assignUnowned("owner-b"), 1);
  assert.equal((await repository.get("bp_old_job")).ownerId, "owner-b");
});

test("indexed summaries retain internal share state for the public shared badge", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "venture-lens-share-index-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const repository = createFileReviewRepository({ dataDir });
  await repository.save({
    id: "copy_shared_index", ownerId: "owner-a", status: "completed", checkpoints: {},
    shareOrigin: { sourceReviewId: "bp_source_index", sourceVersion: "v1", importedAt: "before", forkedAt: "", forkReason: "" }
  });
  const [summary] = await repository.listSummaries({ ownerId: "owner-a" });
  assert.equal(summary.shareOrigin.sourceReviewId, "bp_source_index");
  assert.equal(summary.shareOrigin.sourceVersion, "v1");
});
