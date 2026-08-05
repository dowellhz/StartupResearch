import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("composer occupies a stable workspace row instead of an overflow-clipped overlay", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const workspaceRule = css.match(/\.workspace\s*\{([^}]+)\}/)?.[1] || "";
  const composerRule = css.match(/\.composer-wrap\s*\{([^}]+)\}/)?.[1] || "";

  assert.match(workspaceRule, /grid-template-rows:\s*62px minmax\(0, 1fr\) auto/);
  assert.match(composerRule, /position:\s*relative/);
  assert.doesNotMatch(composerRule, /position:\s*absolute/);
});
