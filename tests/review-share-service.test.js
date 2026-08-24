import test from "node:test";
import assert from "node:assert/strict";
import { createReviewShareService } from "../src/domain/review-share-service.js";

test("shared reviews become idempotent independent copies with isolated follow-ups and assets", async () => {
  const sourceOwner = "owner-source";
  const recipientOwner = "owner-recipient";
  const source = {
    id: "bp_source_review", ownerId: sourceOwner, taskType: "attachment_review", companyName: "光互联",
    status: "completed", reportAvailable: true, checkpoints: { report: { completed: true, artifact: { report: "draft" } } },
    messages: [{ id: "msg_source", role: "user", content: "原问题", status: "complete" }],
    upload: { filename: "bp.pdf", mimeType: "application/pdf", size: 3, storagePath: "source.source", persisted: true },
    pdfStoragePath: "source.pdf", createdAt: "2026-08-01T00:00:00.000Z"
  };
  const jobs = new Map([[source.id, structuredClone(source)]]);
  const reports = new Map([[source.id, "# 原报告"]]);
  const uploads = new Map([[source.id, Buffer.from("bp!")]]);
  const pdfs = new Map([[source.id, Buffer.from("pdf!")]]);
  const repository = {
    get: async (id) => structuredClone(jobs.get(id) || null),
    list: async ({ ownerId }) => [...jobs.values()].filter((job) => job.ownerId === ownerId).map((job) => structuredClone(job)),
    getReport: async (id) => reports.get(id) || "",
    saveReport: async (id, report) => { reports.set(id, report); },
    getUpload: async (id) => uploads.get(id),
    saveUpload: async (id, buffer) => { uploads.set(id, Buffer.from(buffer)); return `${id}.source`; },
    getPdf: async (id) => pdfs.get(id),
    savePdf: async (id, buffer) => { pdfs.set(id, Buffer.from(buffer)); return `${id}.pdf`; },
    save: async (job) => { jobs.set(job.id, structuredClone(job)); return structuredClone(job); }
  };
  const shares = new Map();
  const shareRepository = {
    save: async (share) => { shares.set(share.id, share); return share; },
    get: async (id) => shares.get(id) || null
  };
  const shareIds = [`share_${"s".repeat(32)}`, `share_${"t".repeat(32)}`];
  const reviewIds = ["copy_recipient_one", "copy_recipient_two", "copy_recipient_three"];
  const service = createReviewShareService({
    repository, shareRepository, now: () => "2026-08-24T10:00:00.000Z",
    createShareId: () => shareIds.shift(), createReviewId: () => reviewIds.shift()
  });

  const { id: shareId } = await service.create(source.id, { ownerId: sourceOwner });
  const { id: alternateShareId } = await service.create(source.id, { ownerId: sourceOwner });
  const [first, alternate] = await Promise.all([
    service.importReview(shareId, { ownerId: recipientOwner }),
    service.importReview(alternateShareId, { ownerId: recipientOwner })
  ]);
  const second = await service.importReview(shareId, { ownerId: recipientOwner });

  assert.equal(first.imported, true);
  assert.equal(second.imported, false);
  assert.equal(alternate.imported, false);
  assert.equal(second.review.id, first.review.id);
  assert.equal(alternate.review.id, first.review.id);
  assert.equal(first.review.shared, true);
  assert.equal(first.review.ownerId, undefined);
  assert.equal(first.review.shareOrigin, undefined);
  assert.equal(reports.get(first.review.id), "# 原报告");
  assert.equal(uploads.get(first.review.id).toString(), "bp!");
  assert.equal(pdfs.get(first.review.id).toString(), "pdf!");

  const recipient = jobs.get(first.review.id);
  recipient.messages.push({ id: "msg_recipient", role: "user", content: "接收方后续问题" });
  recipient.shareOrigin.forkedAt = "2026-08-24T10:01:00.000Z";
  recipient.shareOrigin.forkReason = "followup";
  await repository.save(recipient);
  assert.deepEqual(jobs.get(source.id).messages, source.messages);
  assert.equal(jobs.get(first.review.id).messages.length, 2);

  const afterFork = await service.importReview(shareId, { ownerId: recipientOwner });
  assert.equal(afterFork.imported, true);
  assert.notEqual(afterFork.review.id, first.review.id);
  assert.equal(afterFork.review.shared, true);
  assert.equal((await service.importReview(alternateShareId, { ownerId: recipientOwner })).review.id, afterFork.review.id);

  const changedSource = jobs.get(source.id);
  changedSource.messages.push({ id: "msg_new_source", role: "assistant", content: "源对话的新内容", status: "complete" });
  await repository.save(changedSource);
  const newerVersion = await service.importReview(shareId, { ownerId: recipientOwner });
  assert.equal(newerVersion.imported, true);
  assert.notEqual(newerVersion.review.id, afterFork.review.id);
});

test("only owners can create shares and running snapshots are rejected", async () => {
  const job = { id: "bp_running_review", ownerId: "owner-a", status: "running", reportAvailable: true };
  const service = createReviewShareService({
    repository: { get: async () => job, getReport: async () => "# draft" },
    shareRepository: { save: async (value) => value }
  });

  await assert.rejects(service.create(job.id, { ownerId: "owner-b" }), (error) => error.statusCode === 404);
  await assert.rejects(service.create(job.id, { ownerId: "owner-a" }), (error) => error.statusCode === 409);
});
