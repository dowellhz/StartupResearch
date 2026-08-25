import { redactSensitiveText, sanitizeVisibleFilename } from "../../public/privacy-redaction.js";
import { reviewUploads } from "./review-upload-set.js";

export async function extractReviewDocumentSet({ job, repository, extractor, signal, onProgress }) {
  const uploads = reviewUploads(job);
  const documents = [];
  for (let index = 0; index < uploads.length; index += 1) {
    const upload = uploads[index];
    onProgress?.({ message: uploads.length > 1 ? `正在解析第 ${index + 1}/${uploads.length} 份资料：${sanitizeVisibleFilename(upload.filename)}` : "" });
    const persisted = typeof repository.getUpload === "function" ? await repository.getUpload(job.id, upload.storagePath) : null;
    const buffer = persisted || Buffer.from(upload.data || "", "base64");
    const result = await extractor.extract({ buffer, filename: upload.filename, mimeType: upload.mimeType }, { signal, onProgress });
    if (!result.ok) throw new Error(`${sanitizeVisibleFilename(upload.filename)}：${result.error}`);
    documents.push({ ...result.value, filename: sanitizeVisibleFilename(upload.filename) });
  }
  return combineDocuments(documents);
}

export function combineDocuments(documents = []) {
  if (documents.length === 1) return { ...documents[0], text: redactSensitiveText(documents[0].text) };
  let pageOffset = 0;
  const pages = [];
  for (const document of documents) {
    const sourcePages = Array.isArray(document.pages) ? document.pages : [];
    sourcePages.forEach((page, index) => pages.push({
      ...page,
      page: pageOffset + index + 1,
      sourcePage: page.page || index + 1,
      sourceFilename: document.filename
    }));
    pageOffset += sourcePages.length;
  }
  const text = pages.length ? pages.map((page) => [
    `--- 合并第 ${page.page} 页｜${page.sourceFilename} 第 ${page.sourcePage} 页 ---`,
    String(page.text || "")
  ].join("\n")).join("\n\n") : documents.map((document) => `=== 资料：${document.filename} ===\n${String(document.text || "")}`).join("\n\n");
  return {
    filename: `${documents.length} 份资料`,
    filenames: documents.map((document) => document.filename),
    text: redactSensitiveText(text),
    pages,
    pageCount: documents.reduce((total, document) => total + Number(document.pageCount || document.pages?.length || 0), 0),
    originalChars: documents.reduce((total, document) => total + Number(document.originalChars || String(document.text || "").length), 0),
    truncated: documents.some((document) => document.truncated),
    extractionCompleteness: Math.min(...documents.map((document) => Number(document.extractionCompleteness ?? 1))),
    extractionWarning: documents.map((document) => document.extractionWarning).filter(Boolean).join("；"),
    engine: `multi:${documents.map((document) => document.engine || "unknown").join(",")}`
  };
}
