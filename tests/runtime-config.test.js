import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { anthropicMessagesUrl, DEEPSEEK_CREDENTIAL_FIELD, getRuntimeConfig, loadEnvFile, normalizeChatUrl } from "../src/config/runtime-config.js";

test("runtime config normalizes DeepSeek endpoints without exposing defaults as secrets", () => {
  const config = getRuntimeConfig({ DEEPSEEK_BASE_URL: "https://api.deepseek.com", MAX_UPLOAD_MB: "8" });
  assert.equal(config.model.baseUrl, "https://api.deepseek.com/chat/completions");
  assert.equal(config.model.apiKey, "");
  assert.equal(config.model.credentialSource, DEEPSEEK_CREDENTIAL_FIELD);
  assert.equal(config.researchTools.openAlexApiKey, "");
  assert.deepEqual(config.auth.google, { enabled: false, required: false, clientId: "", clientSecret: "", redirectUri: "", sessionSecret: "" });
  assert.equal(config.maxUploadBytes, 8 * 1024 * 1024);
  assert.equal(config.documents.pdfTimeoutMs, 120000);
  assert.equal(config.documents.pdfConcurrency, 1);
  assert.equal(config.recovery.staleAfterMs, 15 * 60 * 1000);
});

test("Google authentication availability and required mode are separate", () => {
  const env = {
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
    GOOGLE_REDIRECT_URI: "https://example.com/auth/google/callback",
    AUTH_SESSION_SECRET: "s".repeat(32)
  };
  const optional = getRuntimeConfig(env);
  assert.equal(optional.auth.google.enabled, true);
  assert.equal(optional.auth.google.required, false);
  const required = getRuntimeConfig({ ...env, GOOGLE_AUTH_REQUIRED: "true" });
  assert.equal(required.auth.google.enabled, true);
  assert.equal(required.auth.google.required, true);
});

test("runtime config has one canonical DeepSeek credential field", () => {
  const config = getRuntimeConfig({ DEEPSEEK_API_KEY: "shared-key" });
  assert.equal(DEEPSEEK_CREDENTIAL_FIELD, "DEEPSEEK_API_KEY");
  assert.equal(config.model.apiKey, "shared-key");
  assert.equal(config.model.credentialSource, "DEEPSEEK_API_KEY");
});

test("env loader rejects duplicate credential definitions", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "venture-lens-env-"));
  const envFile = path.join(directory, ".env");
  await writeFile(envFile, "DEEPSEEK_API_KEY=first\nDEEPSEEK_API_KEY=second\n");
  assert.throws(() => loadEnvFile(envFile), /Duplicate environment field.*DEEPSEEK_API_KEY/);
});

test("runtime config reads bounded PDF extraction and recovery budgets", () => {
  const config = getRuntimeConfig({
    PDF_EXTRACTION_TIMEOUT_MS: "90000",
    PDF_EXTRACTION_CONCURRENCY: "2",
    ACTIVE_TASK_STALE_MINUTES: "30"
  });
  assert.deepEqual(config.documents, { pdfTimeoutMs: 90000, pdfConcurrency: 2 });
  assert.equal(config.recovery.staleAfterMs, 30 * 60 * 1000);
});

test("runtime config reads keyed research credentials only through the config layer", () => {
  const config = getRuntimeConfig({ OPENALEX_API_KEY: "openalex-test-key" });
  assert.equal(config.researchTools.openAlexApiKey, "openalex-test-key");
});

test("DeepSeek chat and Anthropic-compatible URLs are derived consistently", () => {
  assert.equal(normalizeChatUrl("https://api.deepseek.com/v1"), "https://api.deepseek.com/v1/chat/completions");
  assert.equal(anthropicMessagesUrl("https://api.deepseek.com/chat/completions"), "https://api.deepseek.com/anthropic/v1/messages");
});
