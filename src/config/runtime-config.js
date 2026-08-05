import fs from "node:fs";
import path from "node:path";

export function loadEnvFile(filePath = path.resolve(".env")) {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function getRuntimeConfig(env = process.env) {
  const rootDir = path.resolve();
  return {
    host: env.HOST || "127.0.0.1",
    port: positiveNumber(env.PORT, 1234),
    maxUploadBytes: positiveNumber(env.MAX_UPLOAD_MB, 20) * 1024 * 1024,
    dataDir: path.resolve(rootDir, "data"),
    model: {
      apiKey: String(env.DEEPSEEK_API_KEY || "").trim(),
      baseUrl: normalizeChatUrl(env.DEEPSEEK_BASE_URL),
      model: String(env.DEEPSEEK_MODEL || "deepseek-chat").trim(),
      timeoutMs: positiveNumber(env.DEEPSEEK_TIMEOUT_MS, 120000)
    },
    webResearchEnabled: String(env.WEB_RESEARCH_ENABLED ?? "true").toLowerCase() !== "false"
  };
}

export function normalizeChatUrl(value = "") {
  const base = String(value || "https://api.deepseek.com/chat/completions").replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(base) || /\/v1\/chat\/completions$/.test(base)) return base;
  return `${base}/chat/completions`;
}

export function anthropicMessagesUrl(value = "") {
  const url = new URL(normalizeChatUrl(value));
  return `${url.origin}/anthropic/v1/messages`;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
