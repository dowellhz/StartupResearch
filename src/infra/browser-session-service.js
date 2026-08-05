import { randomBytes } from "node:crypto";

const DEFAULT_COOKIE_NAME = "venture_lens_browser";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export function createBrowserSessionService({
  cookieName = DEFAULT_COOKIE_NAME,
  randomId = () => `anon_${randomBytes(32).toString("base64url")}`
} = {}) {
  function resolve(req, res) {
    const cookies = parseCookies(req.headers.cookie || "");
    const existing = normalizeBrowserId(cookies[cookieName]);
    if (existing) return { id: existing, isNew: false };
    const id = normalizeBrowserId(randomId());
    if (!id) throw new Error("无法生成匿名浏览器身份");
    res.setHeader("Set-Cookie", serializeBrowserCookie(cookieName, id, isHttps(req)));
    return { id, isNew: true };
  }

  return { resolve };
}

export function parseCookies(value) {
  const result = {};
  for (const part of String(value || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try {
      result[key] = decodeURIComponent(rawValue);
    } catch {
      result[key] = "";
    }
  }
  return result;
}

export function normalizeBrowserId(value) {
  const id = String(value || "").trim();
  return /^anon_[a-zA-Z0-9_-]{32,100}$/.test(id) ? id : "";
}

function serializeBrowserCookie(name, id, secure) {
  return [
    `${name}=${encodeURIComponent(id)}`,
    "Path=/",
    `Max-Age=${ONE_YEAR_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

function isHttps(req) {
  return Boolean(req.socket?.encrypted) || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}
