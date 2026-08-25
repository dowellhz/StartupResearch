import test from "node:test";
import assert from "node:assert/strict";
import { combineDocuments, extractReviewDocumentSet } from "../src/domain/review-document-set.js";
import { Result } from "../src/domain/result.js";

test("multiple extracted documents retain file boundaries and original page mapping", () => {
  const combined = combineDocuments([
    document("deck.pdf", ["封面", "客户数据"]),
    document("notes.txt", ["访谈记录"])
  ]);
  assert.equal(combined.pageCount, 3);
  assert.deepEqual(combined.pages.map((page) => [page.page, page.sourceFilename, page.sourcePage]), [[1, "deck.pdf", 1], [2, "deck.pdf", 2], [3, "notes.txt", 1]]);
  assert.match(combined.text, /合并第 3 页｜notes\.txt 第 1 页/);
});

test("review document extraction reads every persisted upload in order", async () => {
  const reads = [];
  const job = { id: "bp_multi_docs", upload: { filename: "a.pdf" }, uploads: [{ filename: "a.pdf", storagePath: "a.source" }, { filename: "b.txt", storagePath: "b.source" }] };
  const value = await extractReviewDocumentSet({
    job,
    repository: { getUpload: async (_id, path) => { reads.push(path); return Buffer.from(path); } },
    extractor: { extract: async ({ filename }) => Result.ok(document(filename, [`${filename}正文`])) }
  });
  assert.deepEqual(reads, ["a.source", "b.source"]);
  assert.deepEqual(value.filenames, ["a.pdf", "b.txt"]);
});

function document(filename, values) {
  const pages = values.map((text, index) => ({ page: index + 1, text }));
  return { filename, text: values.join("\n"), pages, pageCount: pages.length, originalChars: values.join("").length, truncated: false, engine: "mock" };
}
