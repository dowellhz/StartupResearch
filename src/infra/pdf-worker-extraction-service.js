import { Worker } from "node:worker_threads";

const DEFAULT_TIMEOUT_MS = 120000;

export function createPdfWorkerExtractionService({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  queue = { run: (task) => task() },
  createWorker = (options) => new Worker(new URL("./pdf-extraction-worker.js", import.meta.url), {
    ...options,
    execArgv: process.execArgv.filter((argument) => !argument.startsWith("--input-type"))
  }),
  terminationTimeoutMs = 3000
} = {}) {
  const budget = Math.max(100, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);

  function extract({ buffer } = {}, context = {}) {
    return queue.run(async () => {
      throwIfAborted(context.signal);
      return runWorker({ buffer, context, budget, createWorker, terminationTimeoutMs });
    });
  }

  return { extract };
}

function runWorker({ buffer, context, budget, createWorker, terminationTimeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker;
    try {
      worker = createWorker({ workerData: { buffer: Buffer.from(buffer || []) } });
    } catch (error) {
      reject(error);
      return;
    }
    const timer = setTimeout(() => finish(new Error(`PDF 文档解析超过 ${Math.ceil(budget / 1000)} 秒，已停止任务；可稍后重试或先对文件进行压缩/OCR`)), budget);
    const onAbort = () => finish(abortError(context.signal));
    context.signal?.addEventListener?.("abort", onAbort, { once: true });
    worker.on("message", (message) => {
      if (message?.type === "progress") context.onProgress?.({ message: String(message.message || "") });
      if (message?.type === "result") finish(null, message.value);
      if (message?.type === "error") finish(new Error(message.message || "PDF Worker 解析失败"));
    });
    worker.on("error", (error) => finish(error));
    worker.on("exit", (code) => {
      if (!settled) finish(new Error(code === 0 ? "PDF Worker 未返回解析结果" : `PDF Worker 异常退出（${code}）`));
    });

    async function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      context.signal?.removeEventListener?.("abort", onAbort);
      await terminateWithin(worker, terminationTimeoutMs);
      if (error) reject(error);
      else resolve(value);
    }
  });
}

async function terminateWithin(worker, timeoutMs) {
  if (!worker?.terminate) return;
  await Promise.race([
    Promise.resolve(worker.terminate()).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, Math.max(100, Number(timeoutMs) || 3000)))
  ]);
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw abortError(signal);
}

function abortError(signal) {
  const error = signal?.reason instanceof Error ? signal.reason : new Error("PDF 解析已取消");
  error.name = "AbortError";
  return error;
}
