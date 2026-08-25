import test from "node:test";
import assert from "node:assert/strict";
import { persistReviewUploadSet, prepareReviewUploadSet, reviewUploads } from "../src/domain/review-upload-set.js";

test("review upload set hashes, persists and restores every initial file", async () => {
  const prepared = prepareReviewUploadSet({ uploads: [upload("deck.pdf", "deck"), upload("notes.txt", "notes")] });
  const writes = [];
  const persisted = await persistReviewUploadSet({
    repository: { saveUpload: async (id, buffer, options) => { writes.push({ id, value: buffer.toString(), options }); return `20260826/${id}-${options.slot + 1}.source`; } },
    jobId: "bp_multi_upload",
    entries: prepared.entries
  });
  assert.equal(prepared.hash.length, 64);
  assert.deepEqual(writes.map((item) => item.value), ["deck", "notes"]);
  assert.deepEqual(persisted.map((item) => item.storagePath), ["20260826/bp_multi_upload-1.source", "20260826/bp_multi_upload-2.source"]);
  assert.deepEqual(reviewUploads({ upload: persisted[0], uploads: persisted }), persisted);
  assert.equal(persisted.some((item) => item.data), false);
});

test("a legacy single upload keeps its content hash for active-task deduplication", () => {
  const prepared = prepareReviewUploadSet({ upload: upload("deck.pdf", "deck") });
  assert.equal(prepared.hash, prepared.entries[0].upload.sha256);
});

function upload(filename, value) {
  return { filename, mimeType: "application/octet-stream", size: value.length, data: Buffer.from(value).toString("base64") };
}
