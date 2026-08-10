import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createGoogleAuthService, googleOwnerId } from "../src/infra/google-auth-service.js";

const NOW = Date.parse("2026-08-10T12:00:00Z");
const CONFIG = {
  enabled: true,
  required: false,
  clientId: "client.apps.googleusercontent.com",
  clientSecret: "client-secret",
  redirectUri: "https://c.example.com/auth/google/callback",
  sessionSecret: "s".repeat(48)
};

test("optional Google auth completes OIDC, signs a session and preserves return path", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
  const idToken = signedJwt(privateKey, {
    iss: "https://accounts.google.com",
    aud: CONFIG.clientId,
    sub: "google-subject-1",
    email: "investor@example.com",
    email_verified: true,
    name: "Investor",
    picture: "https://example.com/avatar.png",
    nonce: "nonce-value",
    iat: Math.floor(NOW / 1000),
    exp: Math.floor(NOW / 1000) + 600
  });
  const fetchImpl = async (url) => {
    if (url === "https://oauth2.googleapis.com/token") return jsonResponse({ id_token: idToken });
    if (url === "https://www.googleapis.com/oauth2/v3/certs") return jsonResponse({ keys: [jwk] }, { "Cache-Control": "public, max-age=3600" });
    throw new Error(`unexpected URL ${url}`);
  };
  const randomValues = ["state-value", "nonce-value"];
  const auth = createGoogleAuthService({ config: CONFIG, fetchImpl, now: () => NOW, random: () => randomValues.shift() });
  const beginResponse = fakeResponse();
  auth.begin(httpsRequest(), beginResponse, new URL("https://c.example.com/auth/google?returnTo=/research/123"));
  const authorization = new URL(beginResponse.headers.Location);
  assert.equal(authorization.searchParams.get("state"), "state-value");
  assert.equal(authorization.searchParams.get("nonce"), "nonce-value");
  const stateCookie = cookiePair(beginResponse.headers["Set-Cookie"], "venture_lens_google_state");

  const callbackResponse = fakeResponse();
  const session = await auth.complete(httpsRequest(stateCookie), callbackResponse, new URL("https://c.example.com/auth/google/callback?code=code-1&state=state-value"));
  assert.equal(session.ownerId, googleOwnerId("google-subject-1"));
  assert.equal(session.returnTo, "/research/123");
  assert.equal(session.user.email, "investor@example.com");
  const authCookie = cookiePair(callbackResponse.headers["Set-Cookie"], "venture_lens_auth");
  const resolved = auth.resolve(httpsRequest(authCookie));
  assert.equal(resolved.ownerId, session.ownerId);
  assert.deepEqual(auth.status(httpsRequest(authCookie)), { enabled: true, required: false, authenticated: true, user: session.user });
});

test("Google auth remains optional by default and refuses an invalid required setup", () => {
  const auth = createGoogleAuthService({ config: { enabled: false, required: false } });
  assert.deepEqual(auth.status(httpsRequest()), { enabled: false, required: false, authenticated: false, user: null });
  assert.throws(() => auth.begin(httpsRequest(), fakeResponse(), new URL("https://c.example.com/auth/google")), (error) => error.statusCode === 404);
  assert.throws(() => createGoogleAuthService({ config: { enabled: false, required: true } }), /强制.*凭证/);
});

function signedJwt(privateKey, claims) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function jsonResponse(value, headers = {}) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json", ...headers } });
}

function httpsRequest(cookie = "") {
  return { headers: { cookie, "x-forwarded-proto": "https" }, socket: {} };
}

function fakeResponse() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    getHeader(name) { return this.headers[name]; },
    writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); },
    end() { this.ended = true; }
  };
}

function cookiePair(header, name) {
  const values = Array.isArray(header) ? header : [header];
  return values.find((value) => String(value).startsWith(`${name}=`)).split(";")[0];
}
