import assert from "node:assert/strict";
import test from "node:test";

import { refreshHealthStatus } from "../public/health-status.js";

test("health status renders the configured model", async () => {
  const modelDot = {};
  const modelText = {};
  await refreshHealthStatus({ requestJson: async () => ({ modelConfigured: true, model: "deepseek-chat" }), modelDot, modelText });
  assert.equal(modelDot.className, "status-dot online");
  assert.equal(modelText.textContent, "deepseek-chat 已连接");
});

test("health status renders connection failures without throwing", async () => {
  const modelDot = {};
  const modelText = {};
  await refreshHealthStatus({ requestJson: async () => { throw new Error("offline"); }, modelDot, modelText });
  assert.equal(modelDot.className, "status-dot offline");
  assert.equal(modelText.textContent, "服务不可用");
});
