import assert from "node:assert/strict";
import test from "node:test";

import { setLanguage } from "../public/i18n.js";
import { progressStageCopy } from "../public/progress-stage-copy.js";

test("English progress copy hides Chinese backend stage messages", () => {
  setLanguage("en", { persist: false });
  const copy = progressStageCopy({ key: "paper-parsing", label: "解析论文", status: "running", message: "正在解析论文" });
  assert.deepEqual(copy, { label: "Paper Parsing", message: "Processing", time: "Processing" });
  setLanguage("zh", { persist: false });
});
