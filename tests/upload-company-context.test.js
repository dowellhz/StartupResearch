import test from "node:test";
import assert from "node:assert/strict";
import { restoreCurrentCompanyContext, setUploadAnalysisState, shouldStartNewAttachmentConversation } from "../public/upload-company-context.js";

test("uploading a BP from a completed review starts a new attachment conversation", () => {
  const review = { companyName: "无尽前沿", reportAvailable: true };
  assert.equal(shouldStartNewAttachmentConversation(review), true);
  assert.equal(shouldStartNewAttachmentConversation({ reportAvailable: false }), false);
  const input = { value: "", disabled: false, placeholder: "公司名称" };
  restoreCurrentCompanyContext(input, review);
  assert.equal(input.value, "无尽前沿");
  assert.equal(input.disabled, true);
});

test("BP analysis exposes a visible loading state and restores the idle message", () => {
  const classes = new Set();
  const filePreview = {
    dataset: {},
    classList: { toggle: (name, active) => active ? classes.add(name) : classes.delete(name) },
    setAttribute: (name, value) => { filePreview[name] = value; }
  };
  const fileMeta = { textContent: "8.7 MB · 等待核查" };
  const removeFile = { disabled: false };
  setUploadAnalysisState({ filePreview, fileMeta, removeFile }, { active: true });
  assert.equal(classes.has("is-analyzing"), true);
  assert.match(fileMeta.textContent, /新对话/);
  assert.equal(removeFile.disabled, true);
  setUploadAnalysisState({ filePreview, fileMeta, removeFile }, { active: false });
  assert.equal(fileMeta.textContent, "8.7 MB · 等待核查");
  assert.equal(removeFile.disabled, false);
});
