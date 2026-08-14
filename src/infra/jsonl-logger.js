import { appendFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export function createJsonlLogger({ dataDir, now = () => new Date().toISOString(), stderr = process.stderr, stdout = process.stdout } = {}) {
  const logsDir = path.join(dataDir, "logs");

  function info(event, fields = {}) {
    stdout?.write?.(`${event}${summary(fields)}\n`);
    return write("app", "info", event, fields);
  }

  function warn(event, fields = {}) {
    stderr?.write?.(`${event}${summary(fields)}\n`);
    return write("app", "warn", event, fields);
  }

  function error(event, fields = {}) {
    stderr?.write?.(`${event}${summary(fields)}\n`);
    return write("app", "error", event, fields);
  }

  function audit(event, fields = {}) {
    return write("audit", "info", event, fields);
  }

  async function write(channel, level, event, fields) {
    const at = now();
    const day = at.slice(0, 10).replaceAll("-", "");
    const record = { at, level, event, ...sanitizeFields(fields) };
    try {
      await mkdir(logsDir, { recursive: true });
      await appendFile(path.join(logsDir, `${channel}-${day}.jsonl`), `${JSON.stringify(record)}\n`, "utf8");
    } catch (writeError) {
      stderr?.write?.(`logger_write_failed: ${writeError.message}\n`);
    }
  }

  return { audit, error, info, warn };
}

export function auditOwner(ownerId) {
  return ownerId ? createHash("sha256").update(String(ownerId)).digest("hex").slice(0, 16) : "";
}

function sanitizeFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => {
    if (key === "ownerId") return ["owner", auditOwner(value)];
    if (value instanceof Error) return [key, { name: value.name, message: value.message, stack: String(value.stack || "").slice(0, 4000) }];
    if (/content|report|prompt|upload|apiKey|secret/i.test(key)) return [key, "[redacted]"];
    return [key, typeof value === "string" ? value.slice(0, 1000) : value];
  }));
}

function summary(fields) {
  const requestId = fields?.requestId ? ` requestId=${fields.requestId}` : "";
  const jobId = fields?.jobId ? ` jobId=${fields.jobId}` : "";
  const rawError = fields?.error instanceof Error ? fields.error.message : fields?.error;
  const error = rawError ? ` error=${JSON.stringify(String(rawError).slice(0, 500))}` : "";
  const failedStep = fields?.failedStep ? ` failedStep=${fields.failedStep}` : "";
  return `${requestId}${jobId}${failedStep}${error}`;
}
