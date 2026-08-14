import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";

test("production shell uses a bounded versioned asset bundle", async () => {
  const root = new URL("../public/assets/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  const files = await readdir(root);
  const javascript = files.filter((name) => name.endsWith(".js"));
  assert.ok(manifest.version.length >= 12);
  assert.ok(javascript.length <= 3, `expected at most 3 JavaScript bundles, received ${javascript.length}`);
  for (const url of [manifest.app, manifest.googleAuth, manifest.styles]) {
    assert.match(url, new RegExp(`\\?v=${manifest.version}$`));
    await access(new URL(url.split("?")[0].replace("/assets/", ""), root));
  }
});
