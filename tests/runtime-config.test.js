import test from "node:test";
import assert from "node:assert/strict";
import { anthropicMessagesUrl, getRuntimeConfig, normalizeChatUrl } from "../src/config/runtime-config.js";

test("runtime config normalizes DeepSeek endpoints without exposing defaults as secrets", () => {
  const config = getRuntimeConfig({ DEEPSEEK_BASE_URL: "https://api.deepseek.com", MAX_UPLOAD_MB: "8" });
  assert.equal(config.model.baseUrl, "https://api.deepseek.com/chat/completions");
  assert.equal(config.model.apiKey, "");
  assert.equal(config.researchTools.openAlexApiKey, "");
  assert.equal(config.maxUploadBytes, 8 * 1024 * 1024);
  assert.equal(config.documents.pdfTimeoutMs, 120000);
  assert.equal(config.documents.pdfConcurrency, 1);
  assert.equal(config.recovery.staleAfterMs, 15 * 60 * 1000);
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
