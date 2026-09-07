import test from "node:test";
import assert from "node:assert/strict";
import { applySecurityHeaders, isHttpsRequest, securityHeaders } from "../src/infra/security-headers.js";

test("默认安全响应头覆盖脚本注入、嵌套框架与来源泄漏", () => {
  const headers = securityHeaders();
  assert.match(headers["Content-Security-Policy"], /default-src 'self'/);
  assert.match(headers["Content-Security-Policy"], /script-src 'self'/);
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(headers["Content-Security-Policy"], /object-src 'none'/);
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.equal(headers["Strict-Transport-Security"], undefined);
});

test("CSP 放行 Google 头像但不放行任意外部脚本", () => {
  const policy = securityHeaders()["Content-Security-Policy"];
  assert.match(policy, /img-src 'self' data: https:\/\/\*\.googleusercontent\.com/);
  assert.equal(/script-src [^;]*https:/.test(policy), false);
});

test("仅在 HTTPS 请求上追加 HSTS", () => {
  assert.equal(securityHeaders({ https: true })["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
  assert.equal(isHttpsRequest({ socket: { encrypted: true }, headers: {} }), true);
  assert.equal(isHttpsRequest({ socket: {}, headers: { "x-forwarded-proto": "https, http" } }), true);
  assert.equal(isHttpsRequest({ socket: {}, headers: { "x-forwarded-proto": "http" } }), false);
  assert.equal(isHttpsRequest(undefined), false);
});

test("安全头写入响应对象", () => {
  const written = {};
  applySecurityHeaders({ setHeader: (name, value) => { written[name] = value; } }, { https: true });
  assert.equal(written["X-Frame-Options"], "DENY");
  assert.equal(written["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
});
