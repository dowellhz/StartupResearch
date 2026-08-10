import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../public/google-auth-ui.js", import.meta.url), "utf8");

test("Google login UI is hidden until server configuration enables it", () => {
  assert.match(html, /google-auth-slot hidden/);
  assert.match(script, /if \(!session\.enabled\) return/);
  assert.match(script, /session\.required && !session\.authenticated/);
  assert.match(html, /使用 Google 登录/);
});
