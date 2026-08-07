import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 120000;

export function createPdfWorkerExtractionService({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  queue = { run: (task) => task() },
  createProcess = () => fork(fileURLToPath(new URL("./pdf-extraction-process.js", import.meta.url)), [], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    serialization: "advanced",
    execArgv: safeChildExecArgv(process.execArgv)
  }),
  terminationTimeoutMs = 3000,
  exitGraceMs = 25
} = {}) {
  const budget = Math.max(100, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);

  function extract({ buffer } = {}, context = {}) {
    return queue.run(async () => {
      throwIfAborted(context.signal);
      return runProcess({ buffer, context, budget, createProcess, terminationTimeoutMs, exitGraceMs });
    });
  }

  return { extract };
}

function runProcess({ buffer, context, budget, createProcess, terminationTimeoutMs, exitGraceMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    try {
      child = createProcess();
      child.send({ buffer: Buffer.from(buffer || []) });
    } catch (error) {
      reject(error);
      return;
    }
    const timer = setTimeout(() => finish(new Error(`PDF 文档解析超过 ${Math.ceil(budget / 1000)} 秒，已停止任务；可稍后重试或先对文件进行压缩/OCR`)), budget);
    const onAbort = () => finish(abortError(context.signal));
    context.signal?.addEventListener?.("abort", onAbort, { once: true });
    child.on("message", (message) => {
      if (message?.type === "progress") context.onProgress?.({ message: String(message.message || "") });
      if (message?.type === "result") finish(null, message.value);
      if (message?.type === "error") finish(new Error(message.message || "PDF 隔离进程解析失败"));
    });
    child.on("error", (error) => finish(error));
    child.on("exit", (code, signal) => {
      setTimeout(() => {
        if (!settled) finish(new Error(code === 0
          ? "PDF 隔离进程未返回解析结果"
          : `PDF 隔离进程异常退出（${signal || code}）`));
      }, Math.max(0, Number(exitGraceMs) || 0));
    });

    async function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      context.signal?.removeEventListener?.("abort", onAbort);
      await terminateWithin(child, terminationTimeoutMs);
      if (error) reject(error);
      else resolve(value);
    }
  });
}

async function terminateWithin(child, timeoutMs) {
  if (!child?.kill || child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolve) => {
      child.once?.("exit", resolve);
      child.kill("SIGKILL");
    }),
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

export function safeChildExecArgv(values = []) {
  const safe = [];
  for (let index = 0; index < values.length; index += 1) {
    const argument = String(values[index] || "");
    if (["-e", "--eval", "-p", "--print"].includes(argument)) {
      index += 1;
      continue;
    }
    if (/^--(?:input-type|eval|print)(?:=|$)/.test(argument)) continue;
    safe.push(argument);
  }
  return safe;
}
