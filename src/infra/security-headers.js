// 本服务承载的是机密投资材料，且报告正文由模型生成后在浏览器里以 innerHTML 注入，
// 因此除了渲染层的转义之外，还需要一层 CSP 兜底。页面没有任何内联脚本/样式或外部资源，
// 唯一的跨域来源是 Google 账号头像，所以策略可以收得很紧。
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https://*.googleusercontent.com",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'"
].join("; ");

export function securityHeaders({ https = false } = {}) {
  return {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    ...(https ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {})
  };
}

export function applySecurityHeaders(res, { https = false } = {}) {
  for (const [name, value] of Object.entries(securityHeaders({ https }))) res.setHeader(name, value);
  return res;
}

export function isHttpsRequest(req) {
  return Boolean(req?.socket?.encrypted)
    || String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}
