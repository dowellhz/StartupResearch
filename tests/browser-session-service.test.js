import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserSessionService, normalizeBrowserId, parseCookies } from "../src/infra/browser-session-service.js";

test("browser session issues a persistent HttpOnly anonymous cookie", () => {
  const headers = {};
  const service = createBrowserSessionService({ randomId: () => `anon_${"a".repeat(43)}` });
  const session = service.resolve({ headers: {}, socket: {} }, { setHeader: (key, value) => { headers[key] = value; } });
  assert.equal(session.isNew, true);
  assert.equal(session.id, `anon_${"a".repeat(43)}`);
  assert.match(headers["Set-Cookie"], /HttpOnly/);
  assert.match(headers["Set-Cookie"], /SameSite=Lax/);
  assert.match(headers["Set-Cookie"], /Max-Age=31536000/);
  assert.doesNotMatch(headers["Set-Cookie"], /Secure/);
});

test("browser session reuses a valid cookie and rejects malformed identifiers", () => {
  const id = `anon_${"b".repeat(43)}`;
  const service = createBrowserSessionService({ randomId: () => `anon_${"c".repeat(43)}` });
  let wroteCookie = false;
  const session = service.resolve({ headers: { cookie: `theme=dark; venture_lens_browser=${id}` }, socket: {} }, {
    setHeader: () => { wroteCookie = true; }
  });
  assert.equal(session.id, id);
  assert.equal(session.isNew, false);
  assert.equal(wroteCookie, false);
  assert.equal(normalizeBrowserId("../../secret"), "");
  assert.deepEqual(parseCookies("a=1; b=hello%20world"), { a: "1", b: "hello world" });
});
