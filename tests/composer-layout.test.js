import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("scrolling history cannot stretch the workspace and hide the composer", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const sidebarRule = css.match(/\.sidebar\s*\{([^}]+)\}/)?.[1] || "";
  const historyRule = css.match(/\.history-list\s*\{([^}]+)\}/)?.[1] || "";
  const workspaceRule = css.match(/\.workspace\s*\{([^}]+)\}/)?.[1] || "";
  const conversationRule = css.match(/\.conversation\s*\{([^}]+)\}/)?.[1] || "";
  const composerRule = css.match(/\.composer-wrap\s*\{([^}]+)\}/)?.[1] || "";

  assert.match(sidebarRule, /min-height:\s*0/);
  assert.match(sidebarRule, /overflow:\s*hidden/);
  assert.match(historyRule, /flex:\s*1 1 auto/);
  assert.match(historyRule, /min-height:\s*0/);
  assert.match(historyRule, /overflow-y:\s*auto/);
  assert.match(workspaceRule, /grid-template-rows:\s*62px minmax\(0, 1fr\) auto/);
  assert.match(conversationRule, /min-height:\s*0/);
  assert.doesNotMatch(conversationRule, /height:\s*100%/);
  assert.match(composerRule, /position:\s*relative/);
  assert.doesNotMatch(composerRule, /position:\s*absolute/);
  assert.doesNotMatch(composerRule, /position:\s*fixed/);
});
