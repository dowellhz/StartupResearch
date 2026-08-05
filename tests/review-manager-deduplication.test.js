import test from "node:test";
import assert from "node:assert/strict";
import { createReviewManagerService } from "../src/domain/review-manager-service.js";

test("concurrent identical uploads reuse one active review", async () => {
  const jobs = new Map();
  let uploadWrites = 0;
  const repository = {
    list: async ({ ownerId }) => Array.from(jobs.values()).filter((job) => job.ownerId === ownerId),
    saveUpload: async (id) => { uploadWrites += 1; return `20260805/${id}.source`; },
    save: async (job) => { jobs.set(job.id, job); return job; },
    get: async (id) => jobs.get(id) || null
  };
  const pipeline = {
    steps: [{ key: "noop", label: "noop" }],
    execute: async () => ({ ok: true })
  };
  const manager = createReviewManagerService({ pipeline, repository, model: {} });
  const input = {
    companyName: "示例公司",
    instruction: "全面核查",
    upload: { filename: "bp.pdf", data: Buffer.from("same-bp").toString("base64") }
  };
  const [first, second] = await Promise.all([
    manager.create(input, { ownerId: "browser-1" }),
    manager.create(input, { ownerId: "browser-1" })
  ]);
  assert.equal(first.id, second.id);
  assert.equal(uploadWrites, 1);
});
