import fs from "node:fs";
import path from "node:path";

export const DEEPSEEK_CREDENTIAL_FIELD = "DEEPSEEK_API_KEY";

export function loadEnvFile(filePath = path.resolve(".env")) {
  if (!fs.existsSync(filePath)) return;
  const seen = new Set();
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (seen.has(key)) throw new Error(`Duplicate environment field in ${filePath}: ${key}`);
    seen.add(key);
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function getRuntimeConfig(env = process.env) {
  const rootDir = path.resolve();
  const production = String(env.NODE_ENV || "development").toLowerCase() === "production";
  const deepSeekApiKey = String(env[DEEPSEEK_CREDENTIAL_FIELD] || "").trim();
  const googleAuth = {
    clientId: String(env.GOOGLE_CLIENT_ID || "").trim(),
    clientSecret: String(env.GOOGLE_CLIENT_SECRET || "").trim(),
    redirectUri: String(env.GOOGLE_REDIRECT_URI || "").trim(),
    sessionSecret: String(env.AUTH_SESSION_SECRET || "").trim(),
    required: String(env.GOOGLE_AUTH_REQUIRED || "false").toLowerCase() === "true"
  };
  googleAuth.enabled = [googleAuth.clientId, googleAuth.clientSecret, googleAuth.redirectUri, googleAuth.sessionSecret].every(Boolean);
  const allowAnonymousProduction = String(env.ALLOW_ANONYMOUS_PRODUCTION || "false").toLowerCase() === "true";
  if (production && !googleAuth.required && !allowAnonymousProduction) {
    throw new Error("生产环境必须启用 GOOGLE_AUTH_REQUIRED=true；如确需匿名公开访问，必须显式设置 ALLOW_ANONYMOUS_PRODUCTION=true");
  }
  return {
    production,
    host: env.HOST || "127.0.0.1",
    port: positiveNumber(env.PORT, 1234),
    maxUploadBytes: positiveNumber(env.MAX_UPLOAD_MB, 20) * 1024 * 1024,
    dataDir: path.resolve(rootDir, env.DATA_DIR || "data"),
    model: {
      apiKey: deepSeekApiKey,
      credentialSource: DEEPSEEK_CREDENTIAL_FIELD,
      baseUrl: normalizeChatUrl(env.DEEPSEEK_BASE_URL),
      model: String(env.DEEPSEEK_MODEL || "deepseek-chat").trim(),
      timeoutMs: positiveNumber(env.DEEPSEEK_TIMEOUT_MS, 120000)
    },
    researchTools: {
      openAlexApiKey: String(env.OPENALEX_API_KEY || "").trim()
    },
    auth: {
      google: googleAuth,
      allowAnonymousProduction
    },
    documents: {
      pdfTimeoutMs: positiveNumber(env.PDF_EXTRACTION_TIMEOUT_MS, 120000),
      pdfConcurrency: positiveNumber(env.PDF_EXTRACTION_CONCURRENCY, 1)
    },
    recovery: {
      staleAfterMs: positiveNumber(env.ACTIVE_TASK_STALE_MINUTES, 15) * 60 * 1000
    },
    security: {
      trustProxy: String(env.TRUST_PROXY || "false").toLowerCase() === "true",
      requestWindowMs: positiveNumber(env.RATE_LIMIT_WINDOW_MS, 60_000),
      requestLimit: positiveNumber(env.RATE_LIMIT_REQUESTS, 120),
      expensiveRequestLimit: positiveNumber(env.RATE_LIMIT_EXPENSIVE_REQUESTS, 10),
      ownerDailyCostUnits: positiveNumber(env.OWNER_DAILY_COST_UNITS, 100),
      globalDailyCostUnits: positiveNumber(env.GLOBAL_DAILY_COST_UNITS, 1000)
    },
    jobs: {
      globalConcurrency: positiveNumber(env.RESEARCH_TASK_CONCURRENCY, 2),
      maxActivePerOwner: positiveNumber(env.MAX_ACTIVE_TASKS_PER_OWNER, 3)
    },
    retention: {
      days: nonNegativeNumber(env.DATA_RETENTION_DAYS, 0),
      graceDays: nonNegativeNumber(env.DATA_RETENTION_GRACE_DAYS, 7)
    },
    semanticQualityCheckEnabled: String(env.SEMANTIC_QUALITY_CHECK_ENABLED ?? "true").toLowerCase() !== "false",
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

function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
