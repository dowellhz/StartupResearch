import test from "node:test";
import assert from "node:assert/strict";
import { createAttachmentSelectionController } from "../public/attachment-selection-controller.js";

test("attachment controller previews and clears an initial multi-file selection", () => {
  const elements = {
    companyInput: { value: "", disabled: false, placeholder: "" },
    fileInput: { value: "selected" },
    fileMeta: { textContent: "" },
    fileName: { textContent: "" },
    filePreview: element(),
    removeFile: { disabled: false }
  };
  const state = { taskType: "attachment_review", currentId: "", currentReview: null, file: null, files: [] };
  let selectedMode = 0;
  const controller = createAttachmentSelectionController({
    elements,
    state,
    taskMode: { selectAttachmentMode: () => { selectedMode += 1; }, selectPaperAnalysisMode: () => {} },
    notify: () => {}
  });
  controller.select([{ name: "deck.pdf", size: 100 }, { name: "notes.txt", size: 50 }]);
  assert.equal(selectedMode, 1);
  assert.equal(state.files.length, 2);
  assert.match(elements.fileName.textContent, /2 份资料/);
  assert.equal(elements.filePreview.classList.contains("hidden"), false);
  controller.clear();
  assert.deepEqual(state.files, []);
  assert.equal(elements.filePreview.classList.contains("hidden"), true);
});

function element() {
  const values = new Set(["hidden"]);
  return {
    dataset: {},
    classList: { add: (...items) => items.forEach((item) => values.add(item)), remove: (...items) => items.forEach((item) => values.delete(item)), contains: (item) => values.has(item), toggle: (item, active) => active ? values.add(item) : values.delete(item) },
    setAttribute() {}
  };
}
