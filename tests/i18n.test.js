import assert from "node:assert/strict";
import test from "node:test";

import { LANGUAGE_EN, LANGUAGE_ZH, detectLanguage, getLanguage, setLanguage, t } from "../public/i18n.js";

test("language detection prefers a saved choice and otherwise follows the browser", () => {
  assert.equal(detectLanguage({ storage: "zh", browserLanguage: "en-US" }), LANGUAGE_ZH);
  assert.equal(detectLanguage({ storage: "", browserLanguage: "zh-CN" }), LANGUAGE_ZH);
  assert.equal(detectLanguage({ storage: "", browserLanguage: "en-GB" }), LANGUAGE_EN);
});

test("manual language selection changes translated interface copy", () => {
  setLanguage("en", { persist: false });
  assert.equal(getLanguage(), LANGUAGE_EN);
  assert.equal(t("sidebar.paper"), "Paper Analysis");
  setLanguage("zh", { persist: false });
  assert.equal(t("sidebar.paper", { zh: "论文解读" }), "论文解读");
});
