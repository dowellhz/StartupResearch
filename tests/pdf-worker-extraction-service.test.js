import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createPdfWorkerExtractionService, safeChildExecArgv } from "../src/infra/pdf-worker-extraction-service.js";

test("PDF child process drops parent eval arguments while retaining safe runtime flags", () => {
  assert.deepEqual(safeChildExecArgv(["--input-type=module", "-e", "console.log('x')", "--trace-warnings"]), ["--trace-warnings"]);
  assert.deepEqual(safeChildExecArgv(["--eval=code", "--print", "value", "--no-warnings"]), ["--no-warnings"]);
});

test("isolated PDF extraction relays progress and returns structured pages", async () => {
  const progress = [];
  const child = fakeProcess((instance) => {
    instance.emit("message", { type: "progress", message: "OCR 1/2" });
    instance.emit("message", { type: "result", value: { text: "正文", pageCount: 1 } });
  });
  const service = createPdfWorkerExtractionService({ timeoutMs: 1000, createProcess: () => child });
  const result = await service.extract({ buffer: Buffer.from("pdf") }, { onProgress: ({ message }) => progress.push(message) });
  assert.deepEqual(result, { text: "正文", pageCount: 1 });
  assert.deepEqual(progress, ["OCR 1/2"]);
  assert.equal(child.terminated, 1);
});

test("isolated PDF extraction terminates a hung parser at its time budget", async () => {
  const child = fakeProcess(() => {});
  const service = createPdfWorkerExtractionService({ timeoutMs: 100, terminationTimeoutMs: 100, createProcess: () => child });
  await assert.rejects(service.extract({ buffer: Buffer.from("pdf") }), /超过 1 秒|超过 0 秒/);
  assert.equal(child.terminated, 1);
});

test("isolated PDF extraction accepts a result queued immediately after a clean exit event", async () => {
  const child = fakeProcess((instance) => {
    instance.emit("exit", 0);
    setImmediate(() => instance.emit("message", { type: "result", value: { text: "late result", pageCount: 1 } }));
  });
  const service = createPdfWorkerExtractionService({ timeoutMs: 1000, exitGraceMs: 25, createProcess: () => child });
  assert.deepEqual(await service.extract({ buffer: Buffer.from("pdf") }), { text: "late result", pageCount: 1 });
});

function fakeProcess(start) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.terminated = 0;
  child.send = () => setImmediate(() => start(child));
  child.kill = () => {
    child.terminated += 1;
    child.exitCode = 0;
    setImmediate(() => child.emit("exit", 0, "SIGKILL"));
    return true;
  };
  return child;
}
