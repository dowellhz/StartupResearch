import test from "node:test";
import assert from "node:assert/strict";
import { apiErrorCodes, localizeApiError } from "../public/api-error-messages.js";
import { LANGUAGE_EN, LANGUAGE_ZH, setLanguage, t } from "../public/i18n.js";
import { requestJson } from "../public/http-client.js";
import { operationalError, publicError } from "../src/infra/public-error.js";

test("每个收录的错误码都有英文文案，不会静默回落到中文", () => {
  setLanguage(LANGUAGE_EN, { persist: false });
  for (const code of apiErrorCodes()) {
    const localized = localizeApiError({ code, message: "中文兜底" });
    assert.notEqual(localized, "中文兜底", `缺少英文文案：${code}`);
    assert.equal(/[一-鿿]/.test(localized), false, `英文文案仍含中文：${code}`);
  }
  setLanguage(LANGUAGE_ZH, { persist: false });
});

test("中文界面保持服务端原文，未知错误码原样透传", () => {
  setLanguage(LANGUAGE_ZH, { persist: false });
  assert.equal(localizeApiError({ code: "report_not_ready", message: "报告尚未生成完成" }), "报告尚未生成完成");
  assert.equal(localizeApiError({ code: "brand_new_code", message: "服务端新错误" }), "服务端新错误");
  assert.equal(localizeApiError({}), t("apiError.generic", { zh: "请求失败，请稍后重试" }));
});

test("英文界面把服务端中文错误替换为英文", () => {
  setLanguage(LANGUAGE_EN, { persist: false });
  assert.equal(localizeApiError({ code: "task_already_running", message: "任务正在运行，无需重复提交" }), "This task is already running.");
  assert.equal(localizeApiError({ code: "brand_new_code", message: "服务端新错误" }), "服务端新错误");
  setLanguage(LANGUAGE_ZH, { persist: false });
});

test("requestJson 抛出的错误保留 code 与 status，并已本地化", async () => {
  setLanguage(LANGUAGE_EN, { persist: false });
  const fetchImpl = async () => new Response(JSON.stringify({ ok: false, error: "任务正在运行，无需重复提交", code: "task_already_running", requestId: "req-9" }), { status: 409 });
  await assert.rejects(requestJson("/api/reviews/x/reanalyze", { method: "POST" }, fetchImpl), (error) => {
    assert.equal(error.message, "This task is already running.");
    assert.equal(error.code, "task_already_running");
    assert.equal(error.status, 409);
    assert.equal(error.requestId, "req-9");
    return true;
  });
  setLanguage(LANGUAGE_ZH, { persist: false });
});

test("用户级错误必须以可暴露的 4xx 返回，而不是被当成 500 吞掉原因", () => {
  const error = operationalError("任务正在运行，无需重复提交", { statusCode: 409, code: "task_already_running" });
  assert.deepEqual(publicError(error), {
    status: 409,
    body: { ok: false, error: "任务正在运行，无需重复提交", code: "task_already_running" }
  });
  // 对照：没有 statusCode 的裸 Error 会被判为 500 并丢掉原因——这正是修复前的行为。
  assert.deepEqual(publicError(new Error("任务正在运行，无需重复提交")), {
    status: 500,
    body: { ok: false, error: "服务器暂时无法完成请求，请稍后重试" }
  });
});
