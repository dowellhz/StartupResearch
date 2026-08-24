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
  const service = createReviewShareService({
    repository, shareRepository, now: () => "2026-08-24T10:00:00.000Z",
    createShareId: () => `share_${"s".repeat(32)}`, createReviewId: () => "copy_recipient_review"
  });

  const { id: shareId } = await service.create(source.id, { ownerId: sourceOwner });
  const first = await service.importReview(shareId, { ownerId: recipientOwner });
  const second = await service.importReview(shareId, { ownerId: recipientOwner });

  assert.equal(first.imported, true);
  assert.equal(second.imported, false);
  assert.equal(second.review.id, first.review.id);
  assert.equal(first.review.ownerId, undefined);
  assert.equal(first.review.shareOrigin, undefined);
  assert.equal(reports.get(first.review.id), "# 原报告");
  assert.equal(uploads.get(first.review.id).toString(), "bp!");
  assert.equal(pdfs.get(first.review.id).toString(), "pdf!");

  const recipient = jobs.get(first.review.id);
  recipient.messages.push({ id: "msg_recipient", role: "user", content: "接收方后续问题" });
  await repository.save(recipient);
  assert.deepEqual(jobs.get(source.id).messages, source.messages);
  assert.equal(jobs.get(first.review.id).messages.length, 2);
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
