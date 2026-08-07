import { parentPort, workerData } from "node:worker_threads";
import { extractPdfDocument } from "./pdf-document-extractor.js";
import { createPdfOcrService } from "./pdf-ocr-service.js";

run().catch((error) => {
  parentPort?.postMessage({ type: "error", message: error.message || String(error) });
  parentPort?.close();
});

async function run() {
  const buffer = Buffer.from(workerData?.buffer || []);
  const pdfOcrService = createPdfOcrService(workerData?.ocrOptions || {});
  const value = await extractPdfDocument(buffer, pdfOcrService, {
    onProgress: ({ message }) => parentPort?.postMessage({ type: "progress", message })
  });
  parentPort?.postMessage({ type: "result", value });
  parentPort?.close();
}
