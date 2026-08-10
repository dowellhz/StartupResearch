import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { parseCookies } from "./browser-session-service.js";

const AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const STATE_COOKIE = "venture_lens_google_state";
const SESSION_COOKIE = "venture_lens_auth";
const STATE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const FETCH_TIMEOUT_MS = 10_000;

export function createGoogleAuthService({ config = {}, fetchImpl = globalThis.fetch, now = () => Date.now(), random = (size) => randomBytes(size).toString("base64url") } = {}) {
  const enabled = config.enabled === true;
  const required = config.required === true;
  const configuredFieldCount = [config.clientId, config.clientSecret, config.redirectUri, config.sessionSecret].filter((value) => String(value || "").trim()).length;
  if (enabled || configuredFieldCount) validateConfig(config);
  if (required && !enabled) throw new Error("Google 登录设为强制，但 OAuth 凭证尚未完整配置");
  let cachedJwks = { expiresAt: 0, keys: [] };

  function status(req) {
    const session = resolve(req);
    return {
      enabled,
      required,
      authenticated: Boolean(session),
      user: session ? session.user : null
    };
  }

  function resolve(req) {
    if (!enabled) return null;
    const token = parseCookies(req.headers.cookie || "")[SESSION_COOKIE];
    const payload = decodeSigned(token, config.sessionSecret);
    if (!payload || payload.expiresAt <= now() || !payload.sub) return null;
    return { ownerId: googleOwnerId(payload.sub), user: publicUser(payload) };
  }

  function begin(req, res, url) {
    assertEnabled();
    const state = random(24);
    const nonce = random(24);
    const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
    const statePayload = encodeSigned({ state, nonce, returnTo, expiresAt: now() + STATE_TTL_SECONDS * 1000 }, config.sessionSecret);
    appendCookie(res, serializeCookie(STATE_COOKIE, statePayload, { maxAge: STATE_TTL_SECONDS, secure: isHttps(req) }));
    const target = new URL(AUTHORIZATION_URL);
    target.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      prompt: "select_account"
    }).toString();
    redirect(res, target.toString());
  }

  async function complete(req, res, url) {
    assertEnabled();
    const cookies = parseCookies(req.headers.cookie || "");
    const statePayload = decodeSigned(cookies[STATE_COOKIE], config.sessionSecret);
    appendCookie(res, serializeCookie(STATE_COOKIE, "", { maxAge: 0, secure: isHttps(req) }));
    if (url.searchParams.get("error")) throw authError(`Google 登录未完成：${url.searchParams.get("error")}`);
    if (!statePayload || statePayload.expiresAt <= now()) throw authError("Google 登录状态已过期，请重新登录");
    if (!safeEqual(statePayload.state, url.searchParams.get("state"))) throw authError("Google 登录状态校验失败");
    const code = String(url.searchParams.get("code") || "");
    if (!code) throw authError("Google 登录没有返回授权码");
    const tokenPayload = await fetchJson(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code"
      })
    }, "Google OAuth token");
    const claims = await verifyIdToken(tokenPayload.id_token, statePayload.nonce);
    const sessionPayload = {
      sub: claims.sub,
      email: claims.email,
      name: claims.name,
      picture: claims.picture,
      issuedAt: now(),
      expiresAt: now() + SESSION_TTL_SECONDS * 1000
    };
    appendCookie(res, serializeCookie(SESSION_COOKIE, encodeSigned(sessionPayload, config.sessionSecret), {
      maxAge: SESSION_TTL_SECONDS,
      secure: isHttps(req)
    }));
    return { ownerId: googleOwnerId(claims.sub), user: publicUser(sessionPayload), returnTo: statePayload.returnTo };
  }

  function logout(req, res) {
    appendCookie(res, serializeCookie(SESSION_COOKIE, "", { maxAge: 0, secure: isHttps(req) }));
  }

  async function verifyIdToken(token, expectedNonce) {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) throw authError("Google ID Token 格式无效");
    const header = decodeJson(parts[0]);
    const claims = decodeJson(parts[1]);
    if (header.alg !== "RS256" || !header.kid) throw authError("Google ID Token 签名算法无效");
    const jwk = (await googleJwks()).find((key) => key.kid === header.kid);
    if (!jwk) throw authError("找不到 Google ID Token 签名密钥");
    const valid = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
    if (!valid) throw authError("Google ID Token 签名校验失败");
    const nowSeconds = Math.floor(now() / 1000);
    if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) throw authError("Google ID Token 签发方无效");
    if (!(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(config.clientId)) throw authError("Google ID Token 客户端不匹配");
    if (!claims.exp || !claims.iat || claims.exp < nowSeconds - 60 || claims.iat > nowSeconds + 60) throw authError("Google ID Token 已过期或时间无效");
    if (!safeEqual(claims.nonce, expectedNonce)) throw authError("Google ID Token nonce 校验失败");
    if (!claims.sub || claims.email_verified !== true) throw authError("Google 账户邮箱尚未验证");
    return claims;
  }

  async function googleJwks() {
    if (cachedJwks.keys.length && cachedJwks.expiresAt > now()) return cachedJwks.keys;
    const response = await fetchImpl(JWKS_URL, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw authError(`Google JWKS HTTP ${response.status}`);
    const payload = await response.json();
    const maxAge = Number(String(response.headers.get("cache-control") || "").match(/max-age=(\d+)/i)?.[1] || 3600);
    cachedJwks = { keys: Array.isArray(payload.keys) ? payload.keys : [], expiresAt: now() + Math.max(60, maxAge) * 1000 };
    return cachedJwks.keys;
  }

  async function fetchJson(url, options, label) {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw authError(`${label} HTTP ${response.status}: ${payload.error_description || payload.error || "request failed"}`);
    return payload;
  }

  function assertEnabled() {
    if (!enabled) throw Object.assign(new Error("Google 登录未启用"), { statusCode: 404 });
  }

  return { begin, complete, enabled, logout, required, resolve, status };
}

export function googleOwnerId(subject) {
  return `google_${createHash("sha256").update(String(subject)).digest("base64url")}`;
}

function validateConfig(config) {
  for (const [key, label] of [["clientId", "GOOGLE_CLIENT_ID"], ["clientSecret", "GOOGLE_CLIENT_SECRET"], ["redirectUri", "GOOGLE_REDIRECT_URI"], ["sessionSecret", "AUTH_SESSION_SECRET"]]) {
    if (!String(config[key] || "").trim()) throw new Error(`Google 登录已启用，但缺少 ${label}`);
  }
  if (String(config.sessionSecret).length < 32) throw new Error("AUTH_SESSION_SECRET 至少需要 32 个字符");
  new URL(config.redirectUri);
}

function encodeSigned(value, secret) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function decodeSigned(value, secret) {
  const [body, signature, extra] = String(value || "").split(".");
  if (!body || !signature || extra || !safeEqual(signature, createHmac("sha256", secret).update(body).digest("base64url"))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function decodeJson(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw authError("Google ID Token JSON 无效");
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function publicUser(value) {
  return {
    email: String(value.email || "").slice(0, 320),
    name: String(value.name || value.email || "Google User").slice(0, 200),
    picture: /^https:\/\//.test(String(value.picture || "")) ? String(value.picture).slice(0, 1000) : ""
  };
}

function safeReturnTo(value) {
  const target = String(value || "/");
  return target.startsWith("/") && !target.startsWith("//") ? target : "/";
}

function serializeCookie(name, value, { maxAge, secure }) {
  return [`${name}=${encodeURIComponent(value)}`, "Path=/", `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Lax", secure ? "Secure" : ""].filter(Boolean).join("; ");
}

function appendCookie(res, cookie) {
  const current = res.getHeader?.("Set-Cookie");
  res.setHeader("Set-Cookie", current ? [...(Array.isArray(current) ? current : [current]), cookie] : cookie);
}

function isHttps(req) {
  return Boolean(req.socket?.encrypted) || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function authError(message) {
  return Object.assign(new Error(message), { statusCode: 401 });
}
