import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPublicAssetService, injectManifest } from "../src/infra/public-asset-service.js";

test("asset manifest injects versioned bundles into the shell", () => {
  const html = '<link rel="stylesheet" href="/styles.css"><script type="module" src="/app.js"></script><script type="module" src="/google-auth-ui.js"></script>';
  const value = injectManifest(html, {
    version: "abc123",
    styles: "/assets/styles.css?v=abc123",
    app: "/assets/app.js?v=abc123",
    googleAuth: "/assets/google-auth-ui.js?v=abc123"
  });
  assert.match(value, /assets\/styles\.css\?v=abc123/);
  assert.match(value, /assets\/app\.js\?v=abc123/);
  assert.match(value, /assets\/google-auth-ui\.js\?v=abc123/);
});

test("built assets receive immutable caching while HTML remains fresh", async () => {
  const publicDir = await mkdtemp(path.join(os.tmpdir(), "venture-assets-"));
  try {
    await mkdir(path.join(publicDir, "assets"));
    await writeFile(path.join(publicDir, "index.html"), '<script type="module" src="/app.js"></script>');
    await writeFile(path.join(publicDir, "assets", "app.js"), "console.log('built')");
    await writeFile(path.join(publicDir, "assets", "manifest.json"), JSON.stringify({ version: "v1", app: "/assets/app.js?v=v1" }));
    const service = await createPublicAssetService({ publicDir });
    const html = responseRecorder();
    await service.serve(html, "/");
    assert.equal(html.status, 200);
    assert.equal(html.headers["Cache-Control"], "no-cache");
    assert.match(html.body.toString(), /assets\/app\.js\?v=v1/);
    const asset = responseRecorder();
    await service.serve(asset, "/assets/app.js");
    assert.equal(asset.headers["Cache-Control"], "public, max-age=31536000, immutable");
  } finally {
    await rm(publicDir, { recursive: true, force: true });
  }
});

function responseRecorder() {
  return {
    status: 0,
    headers: {},
    body: Buffer.alloc(0),
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = "") { this.body = Buffer.isBuffer(body) ? body : Buffer.from(body); }
  };
}
