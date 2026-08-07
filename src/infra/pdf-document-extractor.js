import { PDFParse } from "pdf-parse";
import { removeRepeatedPdfWatermarks } from "./pdf-watermark-cleaner.js";

export async function extractPdfDocument(buffer, pdfOcrService, context = {}, {
  createParser = (data) => new PDFParse({ data, useSystemFonts: true })
} = {}) {
  const parser = createParser(buffer);
  try {
    const result = await parser.getText({ pageJoiner: "\n\n" });
    const nativePages = (Array.isArray(result?.pages) ? result.pages : []).map((page, index) => ({
      page: Number(page?.num || page?.pageNumber || index + 1),
      text: String(page?.text || "")
    }));
    const cleaned = removeRepeatedPdfWatermarks(nativePages);
    const enhanced = pdfOcrService?.enhance
      ? await pdfOcrService.enhance({ buffer, pages: cleaned.pages, pageCount: Number(result?.total || nativePages.length || 0) }, context)
      : { pages: cleaned.pages, ocrPageCount: 0, ocrCandidatePageCount: 0, ocrUsefulPageCount: 0, ocrSkippedAfterProbe: [], removedWatermarkLines: cleaned.removedLineCount, warning: "" };
    const pages = enhanced.pages || cleaned.pages;
    const text = pages.length
      ? pages.map((page, index) => `--- 第 ${page.page || index + 1} 页 ---\n${page.text || ""}`).join("\n\n")
      : String(result?.text || "");
    return {
      text,
      pages,
      pageCount: Number(result?.total || pages.length || 0) || null,
      engine: enhanced.ocrPageCount ? "pdf-parse+tesseract.js" : "pdf-parse",
      ocrPageCount: Number(enhanced.ocrPageCount || 0),
      ocrCandidatePageCount: Number(enhanced.ocrCandidatePageCount || 0),
      ocrUsefulPageCount: Number(enhanced.ocrUsefulPageCount || 0),
      ocrSkippedAfterProbe: Array.isArray(enhanced.ocrSkippedAfterProbe) ? enhanced.ocrSkippedAfterProbe : [],
      removedWatermarkLines: Number(enhanced.removedWatermarkLines ?? cleaned.removedLineCount ?? 0),
      extractionCompleteness: Number(enhanced.extractionCompleteness ?? 1),
      blankPageCount: Number(enhanced.blankPageCount || 0),
      blankPages: Array.isArray(enhanced.blankPages) ? enhanced.blankPages : [],
      skippedOcrPages: Array.isArray(enhanced.skippedOcrPages) ? enhanced.skippedOcrPages : [],
      extractionWarning: enhanced.warning || ""
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}
