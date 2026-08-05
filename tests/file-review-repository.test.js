import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
