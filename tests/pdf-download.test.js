import test from "node:test";
import assert from "node:assert/strict";
import { downloadConversationPdf, downloadReviewPdf, syncConversationPdfButton } from "../public/pdf-download.js";

test("PDF download helpers route report and whole-conversation exports separately", () => {
  const visited = [];
  const location = { assign: (url) => visited.push(url) };
  assert.equal(downloadReviewPdf("bp_123456", location), true);
  assert.equal(downloadConversationPdf("bp_123456", location), true);
  assert.equal(downloadConversationPdf("", location), false);
  assert.deepEqual(visited, ["/api/reviews/bp_123456/pdf", "/api/reviews/bp_123456/conversation-pdf"]);
});

test("whole-conversation PDF button is disabled until a conversation is selected", () => {
  const attributes = {};
  const button = { disabled: false, setAttribute: (key, value) => { attributes[key] = value; } };
  syncConversationPdfButton(button, "");
  assert.equal(button.disabled, true);
  assert.equal(attributes["aria-disabled"], "true");
  syncConversationPdfButton(button, "bp_123456");
  assert.equal(button.disabled, false);
  assert.equal(attributes["aria-disabled"], "false");
});
