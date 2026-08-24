import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFileShareRepository } from "../src/storage/file-share-repository.js";

test("file share repository persists opaque share records", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "venture-lens-share-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const repository = createFileShareRepository({ dataDir });
  const share = { id: `share_${"a".repeat(32)}`, sourceReviewId: "bp_source_review", createdAt: "2026-08-24T00:00:00.000Z" };

  assert.deepEqual(await repository.save(share), share);
  assert.deepEqual(await repository.get(share.id), share);
  assert.equal(await repository.get(`share_${"b".repeat(32)}`), null);
  await assert.rejects(repository.get("../job-index"), /分享链接无效/);
});
