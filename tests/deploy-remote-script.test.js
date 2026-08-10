import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = await readFile(new URL("../scripts/deploy-remote.sh", import.meta.url), "utf8");

test("remote deploy requires an exact clean origin/main release", () => {
  assert.match(script, /git status --porcelain/);
  assert.match(script, /git rev-parse origin\/\$DEPLOY_BRANCH/);
  assert.match(script, /deployment requires branch/);
});

test("remote deploy protects runtime state and credentials", () => {
  for (const path of [".env", "data/", "node_modules/", "output/", "tmp/"]) {
    assert.match(script, new RegExp(`--exclude=${path.replace(/[./]/g, "\\$&")}`));
  }
  assert.match(script, /MAX_REMOTE_DELETIONS/);
  assert.match(script, /startup-research-backups/);
  assert.match(script, /exactly one DEEPSEEK_API_KEY field/);
  assert.match(script, /EnvironmentFile=\$REMOTE_DIR\/\.env/);
});

test("remote deploy verifies service, public health, OpenAlex and commit identity", () => {
  assert.match(script, /systemctl restart/);
  assert.match(script, /PUBLIC_HEALTH_URL/);
  assert.match(script, /https:\/\/c\.nlvcwiki\.com\/api\/health/);
  assert.match(script, /openalex_research_search/);
  assert.match(script, /remote deployment version mismatch/);
});
