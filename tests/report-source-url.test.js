import test from "node:test";
import assert from "node:assert/strict";
import { citationDocumentUrl } from "../src/domain/report-source-url.js";

test("article fragment variants share identity without conflating routes or query parameters", () => {
  assert.equal(citationDocumentUrl("https://example.com/article#comment#1"), "https://example.com/article");
  assert.equal(citationDocumentUrl("https://example.com/article#1"), citationDocumentUrl("https://example.com/article"));
  assert.notEqual(citationDocumentUrl("https://example.com/?id=1"), citationDocumentUrl("https://example.com/?id=2"));
  assert.notEqual(citationDocumentUrl("https://example.com/#/a"), citationDocumentUrl("https://example.com/#/b"));
  assert.notEqual(citationDocumentUrl("https://example.com/#!/a"), citationDocumentUrl("https://example.com/#!/b"));
  assert.equal(citationDocumentUrl("javascript:alert(1)"), "");
});
