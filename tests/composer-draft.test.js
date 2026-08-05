import test from "node:test";
import assert from "node:assert/strict";
import { createComposerDraftController } from "../public/composer-draft.js";

test("legacy drafts do not restore a company name captured from an old review", () => {
  const values = new Map([["venture-lens:composer-draft", JSON.stringify({ companyName: "旧公司", prompt: "继续核查" })]]);
  globalThis.localStorage = storage(values);
  const companyInput = { value: "" };
  const promptInput = { value: "" };
  createComposerDraftController({ companyInput, promptInput }).restore();
  assert.equal(companyInput.value, "");
  assert.equal(promptInput.value, "继续核查");
});

test("only an explicitly edited company name is restored", () => {
  const values = new Map();
  globalThis.localStorage = storage(values);
  const companyInput = { value: "三向纪元" };
  const promptInput = { value: "全面核查" };
  const draft = createComposerDraftController({ companyInput, promptInput });
  draft.saveCompany();
  companyInput.value = "";
  promptInput.value = "";
  draft.restore();
  assert.equal(companyInput.value, "三向纪元");
  assert.equal(promptInput.value, "全面核查");
});

test("programmatic review labels are not persisted as explicit company input", () => {
  const values = new Map();
  globalThis.localStorage = storage(values);
  const companyInput = { value: "历史公司" };
  const promptInput = { value: "追问" };
  const draft = createComposerDraftController({ companyInput, promptInput });
  draft.save();
  const saved = JSON.parse(values.get("venture-lens:composer-draft"));
  assert.equal(saved.companyName, "");
  assert.equal(saved.companyExplicit, false);
});

test("clearing a submitted prompt recalculates the textarea height after its value is empty", () => {
  const values = new Map();
  globalThis.localStorage = storage(values);
  const companyInput = { value: "示例科技" };
  const promptInput = { value: "很长的预研要求" };
  let resizedValue = "not-called";
  const draft = createComposerDraftController({
    companyInput,
    promptInput,
    onRestore: () => { resizedValue = promptInput.value; }
  });
  draft.clearPrompt();
  assert.equal(promptInput.value, "");
  assert.equal(resizedValue, "");
});

function storage(values) {
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}
