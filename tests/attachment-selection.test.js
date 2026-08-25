import test from "node:test";
import assert from "node:assert/strict";
import { MAX_INITIAL_ATTACHMENT_BYTES, selectAttachmentFiles, totalAttachmentBytes } from "../public/attachment-selection.js";

test("initial attachment selection keeps multiple valid files in browser order", () => {
  const files = [file("deck.pdf", 10), file("notes.docx", 20), file("memo.md", 30)];
  const result = selectAttachmentFiles({ incoming: files });
  assert.equal(result.ok, true);
  assert.deepEqual(result.files.map((item) => item.name), ["deck.pdf", "notes.docx", "memo.md"]);
  assert.equal(totalAttachmentBytes(result.files), 60);
});

test("additional picks append without duplicating an already selected file", () => {
  const deck = file("deck.pdf", 10, 1);
  const result = selectAttachmentFiles({ existing: [deck], incoming: [deck, file("memo.txt", 5)] });
  assert.deepEqual(result.files.map((item) => item.name), ["deck.pdf", "memo.txt"]);
});

test("existing conversations and paper analysis retain a single-file boundary", () => {
  const files = [file("first.pdf", 10), file("second.pdf", 20)];
  assert.equal(selectAttachmentFiles({ incoming: files, allowMultiple: false }).code, "single_only");
  assert.deepEqual(selectAttachmentFiles({ incoming: files, paperAnalysis: true }).files.map((item) => item.name), ["first.pdf"]);
  assert.equal(selectAttachmentFiles({ incoming: [file("paper.docx", 1)], paperAnalysis: true }).code, "paper_pdf");
});

test("initial attachment selection enforces count and combined size budgets", () => {
  assert.equal(selectAttachmentFiles({ incoming: Array.from({ length: 9 }, (_, index) => file(`${index}.pdf`, 1)) }).code, "too_many");
  assert.equal(selectAttachmentFiles({ incoming: [file("a.pdf", MAX_INITIAL_ATTACHMENT_BYTES), file("b.txt", 1)] }).code, "total_size");
});

function file(name, size, lastModified = 0) { return { name, size, lastModified }; }
