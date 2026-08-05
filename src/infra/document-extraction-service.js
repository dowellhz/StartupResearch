import path from "node:path";
import JSZip from "jszip";
import { PDFParse } from "pdf-parse";
import { Result } from "../domain/result.js";
import { removeRepeatedPdfWatermarks } from "./pdf-watermark-cleaner.js";

export function createDocumentExtractionService({ maxBytes = 20 * 1024 * 1024, pdfOcrService = null } = {}) {
  async function extract({ buffer, filename = "business-plan.pdf", mimeType = "" } = {}, context = {}) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) return Result.fail("上传文件为空");
    if (buffer.length > maxBytes) return Result.fail(`文件超过 ${Math.round(maxBytes / 1024 / 1024)} MB`);
    const ext = path.extname(filename).toLowerCase();
    try {
      let extracted;
      if (ext === ".pdf" || mimeType === "application/pdf") extracted = await extractPdf(buffer, pdfOcrService, context);
      else if (ext === ".pptx") extracted = await extractOfficeXml(buffer, "pptx");
      else if (ext === ".docx") extracted = await extractOfficeXml(buffer, "docx");
      else if ([".txt", ".md", ".markdown"].includes(ext) || mimeType.startsWith("text/")) {
        extracted = { text: buffer.toString("utf8"), pageCount: null, engine: "plain-text" };
      } else {
        return Result.fail("暂不支持该文件格式，请上传 PDF、PPTX、DOCX、TXT 或 Markdown");
      }
      const text = normalizeExtractedText(extracted.text);
      if (text.replace(/\s/g, "").length < 80) {
        return Result.fail("文件有效文本过少；如果是扫描版 PDF，请先进行 OCR");
      }
      return Result.ok({
        ...extracted,
        text: text.slice(0, 120000),
        originalChars: text.length,
        truncated: text.length > 120000
      });
    } catch (error) {
      return Result.fail(`文件解析失败：${error.message || error}`);
    }
  }

  return { extract };
}

async function extractPdf(buffer, pdfOcrService, context) {
  const parser = new PDFParse({ data: buffer, useSystemFonts: true });
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

async function extractOfficeXml(buffer, type) {
  const archive = await JSZip.loadAsync(buffer);
  const pattern = type === "pptx" ? /^ppt\/slides\/slide\d+\.xml$/ : /^word\/document\.xml$/;
  const files = Object.values(archive.files).filter((file) => pattern.test(file.name)).sort(naturalSort);
  if (!files.length) throw new Error("Office 文档结构无效");
  const parts = [];
  for (const [index, file] of files.entries()) {
    const xml = await file.async("string");
    const texts = Array.from(xml.matchAll(/<(?:a:t|w:t)(?:\s[^>]*)?>([\s\S]*?)<\/(?:a:t|w:t)>/g))
      .map((match) => decodeXml(match[1]).trim())
      .filter(Boolean);
    if (texts.length) parts.push(`${type === "pptx" ? `--- 第 ${index + 1} 页 ---\n` : ""}${texts.join("\n")}`);
  }
  return { text: parts.join("\n\n"), pageCount: type === "pptx" ? parts.length : null, engine: `${type}-xml` };
}

function naturalSort(a, b) {
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeExtractedText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
