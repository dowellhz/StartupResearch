import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createPdfWorkerExtractionService } from "../src/infra/pdf-worker-extraction-service.js";

test("PDF worker extraction relays progress and returns structured pages", async () => {
  const progress = [];
  const worker = fakeWorker((instance) => {
    instance.emit("message", { type: "progress", message: "OCR 1/2" });
    instance.emit("message", { type: "result", value: { text: "正文", pageCount: 1 } });
  });
  const service = createPdfWorkerExtractionService({ timeoutMs: 1000, createWorker: () => worker });
  const result = await service.extract({ buffer: Buffer.from("pdf") }, { onProgress: ({ message }) => progress.push(message) });
  assert.deepEqual(result, { text: "正文", pageCount: 1 });
  assert.deepEqual(progress, ["OCR 1/2"]);
  assert.equal(worker.terminated, 1);
});

test("PDF worker extraction terminates a hung parser at its time budget", async () => {
  const worker = fakeWorker(() => {});
  const service = createPdfWorkerExtractionService({ timeoutMs: 100, terminationTimeoutMs: 100, createWorker: () => worker });
  await assert.rejects(service.extract({ buffer: Buffer.from("pdf") }), /超过 1 秒|超过 0 秒/);
  assert.equal(worker.terminated, 1);
});

function fakeWorker(start) {
  const worker = new EventEmitter();
  worker.terminated = 0;
  worker.terminate = async () => { worker.terminated += 1; };
  setImmediate(() => start(worker));
  return worker;
}
