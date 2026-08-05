import test from "node:test";
import assert from "node:assert/strict";
import { filesFromDrop } from "../public/file-drop.js";

test("file drop keeps valid dropped files in browser order", () => {
  const files = filesFromDrop({ dataTransfer: { files: [{ name: "first.pdf" }, { name: "second.pptx" }, {}] } });
  assert.deepEqual(files.map((file) => file.name), ["first.pdf", "second.pptx"]);
});
