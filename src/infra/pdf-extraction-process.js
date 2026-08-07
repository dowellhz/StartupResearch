import { extractPdfDocument } from "./pdf-document-extractor.js";
import { createPdfOcrService } from "./pdf-ocr-service.js";

process.once("message", (message) => {
  run(message).catch((error) => sendAndClose({ type: "error", message: error.message || String(error) }));
});

async function run(message) {
  const buffer = Buffer.from(message?.buffer || []);
  const pdfOcrService = createPdfOcrService(message?.ocrOptions || {});
  const value = await extractPdfDocument(buffer, pdfOcrService, {
    onProgress: ({ message: progress }) => process.send?.({ type: "progress", message: progress })
  });
  sendAndClose({ type: "result", value });
}

function sendAndClose(message) {
  if (!process.send) return process.exitCode = message.type === "result" ? 0 : 1;
  process.send(message, () => process.disconnect());
}
