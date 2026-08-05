import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";
import { meaningfulCharacterCount, mergePageText, removeRepeatedPdfWatermarks } from "./pdf-watermark-cleaner.js";

const require = createRequire(import.meta.url);
const chiSimData = require("@tesseract.js-data/chi_sim");
const engData = require("@tesseract.js-data/eng");

export function createPdfOcrService({
  createParser = (buffer) => new PDFParse({ data: buffer, useSystemFonts: true }),
  createOcrWorker = defaultCreateOcrWorker,
  createLanguageDirectory = defaultCreateLanguageDirectory,
  renderScale = 1.7,
  renderBatchSize = 4,
  directTextThreshold = 40,
  textThreshold = 120,
  probePageCount = 2,
  maxOcrPages = 40
} = {}) {
  async function enhance({ buffer, pages = [], pageCount = pages.length } = {}, context = {}) {
    const selection = { directTextThreshold, textThreshold };
    const textTargets = selectOcrTargets(pages, { ...selection, maxOcrPages: Number.POSITIVE_INFINITY });
    const imageCheckPages = selectImageCheckPages(pages, selection).filter((page) => !textTargets.includes(page));
    if (!textTargets.length && !imageCheckPages.length) return {
      pages,
      ocrPageCount: 0,
      ocrCandidatePageCount: 0,
      ocrUsefulPageCount: 0,
      ocrSkippedAfterProbe: [],
      ...assessPageExtraction(pages, { pageCount, skippedOcrPages: [] })
    };
    let parser;
    let worker;
    let languageDirectory;
    let targets = [];
    let skippedOcrPages = [];
    try {
      parser = createParser(buffer);
      const imagePages = await detectImagePages(parser, imageCheckPages);
      const allTargets = rankAndLimitTargets([...textTargets, ...imagePages], pages, Number.POSITIVE_INFINITY);
      targets = rankAndLimitTargets(allTargets, pages, maxOcrPages);
      skippedOcrPages = allTargets.filter((page) => !targets.includes(page));
      if (!targets.length) return {
        pages,
        ocrPageCount: 0,
        ocrCandidatePageCount: 0,
        ocrUsefulPageCount: 0,
        ocrSkippedAfterProbe: [],
        ...assessPageExtraction(pages, { pageCount, skippedOcrPages })
      };
      context.onProgress?.({ message: `检测到近空白、乱码或图像型内容，正在 OCR 抽样 ${Math.min(probePageCount, targets.length)} 页…` });
      languageDirectory = await createLanguageDirectory();
      worker = await createOcrWorker(languageDirectory.path);
      const byPage = new Map(pages.map((page) => [Number(page.page), String(page.text || "")]));
      let completed = 0;
      let useful = 0;
      let skippedAfterProbe = [];
      const probes = chooseProbeTargets(targets, pages, probePageCount);
      const remaining = targets.filter((page) => !probes.includes(page));
      const probeResult = await recognizePages(probes);
      if (!probeResult.useful && remaining.length) {
        skippedAfterProbe = remaining;
        context.onProgress?.({ message: `OCR 抽样未补充有效内容，已跳过剩余 ${remaining.length} 页…` });
      } else {
        for (let offset = 0; offset < remaining.length; offset += renderBatchSize) {
          await recognizePages(remaining.slice(offset, offset + renderBatchSize));
        }
      }

      async function recognizePages(partial) {
        if (!partial.length) return { useful: 0 };
        throwIfAborted(context.signal);
        const screenshots = await parser.getScreenshot({
          partial,
          scale: renderScale,
          imageBuffer: true,
          imageDataUrl: false
        });
        for (const screenshot of screenshots.pages || []) {
          throwIfAborted(context.signal);
          const page = Number(screenshot.pageNumber || 0);
          const recognized = await worker.recognize(Buffer.from(screenshot.data || []));
          const merged = mergePageText(byPage.get(page), recognized?.data?.text);
          const added = merged.includes("[OCR 补充]") && !String(byPage.get(page) || "").includes("[OCR 补充]");
          byPage.set(page, merged);
          completed += 1;
          if (added) useful += 1;
          context.onProgress?.({ message: `OCR 补全进度 ${completed}/${targets.length} 页…` });
        }
        return { useful };
      }
      const merged = Array.from({ length: pageCount }, (_, index) => ({
        page: index + 1,
        text: byPage.get(index + 1) || ""
      }));
      const cleaned = removeRepeatedPdfWatermarks(merged);
      const assessment = assessPageExtraction(cleaned.pages, { pageCount, skippedOcrPages });
      return {
        pages: cleaned.pages,
        ocrPageCount: completed,
        ocrCandidatePageCount: targets.length,
        ocrUsefulPageCount: useful,
        ocrSkippedAfterProbe: skippedAfterProbe,
        removedWatermarkLines: cleaned.removedLineCount,
        ...assessment
      };
    } catch (error) {
      if (context.signal?.aborted) throw error;
      const assessment = assessPageExtraction(pages, { pageCount, skippedOcrPages });
      return {
        ...assessment,
        pages,
        ocrPageCount: 0,
        ocrCandidatePageCount: targets.length,
        ocrUsefulPageCount: 0,
        ocrSkippedAfterProbe: [],
        warning: joinWarnings(`OCR 补全降级：${error.message || error}`, assessment.warning)
      };
    } finally {
      await worker?.terminate?.().catch(() => {});
      await parser?.destroy?.().catch(() => {});
      await languageDirectory?.cleanup?.().catch(() => {});
    }
  }

  return { enhance };
}

export function selectOcrTargets(pages = [], { directTextThreshold = 40, textThreshold = 120, maxOcrPages = 40 } = {}) {
  const directThreshold = Math.min(directTextThreshold, textThreshold);
  return pages
    .map((page, index) => ({
      page: Number(page?.page || index + 1),
      chars: meaningfulCharacterCount(page?.text),
      text: String(page?.text || "")
    }))
    .filter((page) => page.chars < directThreshold || page.chars < textThreshold && needsConditionalOcr(page.text))
    .sort((left, right) => left.chars - right.chars)
    .slice(0, maxOcrPages)
    .map((page) => page.page)
    .sort((left, right) => left - right);
}

export function needsConditionalOcr(text) {
  const value = String(text || "");
  if (looksCorrupted(value)) return true;
  return /(?:^|\n).{0,18}(?:图表|示意图|架构图|流程图|路线图|数据图|参数表|指标表|截图)|\b(?:figure|fig\.?|table|chart|diagram)\b/i.test(value);
}

export function selectImageCheckPages(pages = [], { directTextThreshold = 40, textThreshold = 120 } = {}) {
  const directThreshold = Math.min(directTextThreshold, textThreshold);
  return pages
    .map((page, index) => ({ page: Number(page?.page || index + 1), chars: meaningfulCharacterCount(page?.text) }))
    .filter(({ chars }) => chars >= directThreshold && chars < textThreshold)
    .map(({ page }) => page);
}

export function imageHeavyPages(result, { minimumWidth = 320, minimumHeight = 180, minimumArea = 120000 } = {}) {
  return (result?.pages || [])
    .filter((page) => (page.images || []).some((image) => {
      const width = Number(image?.width || 0);
      const height = Number(image?.height || 0);
      return width >= minimumWidth && height >= minimumHeight && width * height >= minimumArea;
    }))
    .map((page) => Number(page.pageNumber || 0))
    .filter(Boolean);
}

async function detectImagePages(parser, candidates) {
  if (!candidates.length || typeof parser?.getImage !== "function") return [];
  try {
    const result = await parser.getImage({ partial: candidates, imageThreshold: 120, imageBuffer: false, imageDataUrl: false });
    return imageHeavyPages(result);
  } catch {
    return [];
  }
}

function rankAndLimitTargets(targets, pages, limit) {
  const chars = new Map(pages.map((page, index) => [Number(page?.page || index + 1), meaningfulCharacterCount(page?.text)]));
  return Array.from(new Set(targets))
    .sort((left, right) => (chars.get(left) || 0) - (chars.get(right) || 0))
    .slice(0, limit)
    .sort((left, right) => left - right);
}

function looksCorrupted(value) {
  const text = String(value || "");
  const replacementCount = (text.match(/[�□■]/g) || []).length;
  const controlCount = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  return replacementCount + controlCount >= 2;
}

function chooseProbeTargets(targets, pages, count) {
  const budget = Math.max(1, Math.min(Number(count || 1), targets.length));
  if (targets.length <= budget) return [...targets];
  const chars = new Map(pages.map((page, index) => [Number(page?.page || index + 1), meaningfulCharacterCount(page?.text)]));
  const ranked = [...targets].sort((left, right) => (chars.get(left) || 0) - (chars.get(right) || 0));
  if (budget === 1) return [ranked[0]];
  const selected = [ranked[0], ranked[Math.floor(ranked.length / 2)]];
  for (const page of ranked) {
    if (selected.length >= budget) break;
    if (!selected.includes(page)) selected.push(page);
  }
  return selected.sort((left, right) => left - right);
}

export function assessPageExtraction(pages = [], { pageCount = pages.length, skippedOcrPages = [] } = {}) {
  const normalizedPageCount = Math.max(Number(pageCount || 0), pages.length);
  const blankPages = pages
    .filter((page) => meaningfulCharacterCount(page?.text) < 12)
    .map((page, index) => Number(page?.page || index + 1));
  const usablePages = pages.filter((page) => meaningfulCharacterCount(page?.text) >= 40).length;
  const extractionCompleteness = normalizedPageCount ? Math.round((usablePages / normalizedPageCount) * 1000) / 1000 : 1;
  const warnings = [];
  if (skippedOcrPages.length) warnings.push(`有 ${skippedOcrPages.length} 个低文本页面超出 OCR 预算，页码：${formatPages(skippedOcrPages)}`);
  if (blankPages.length) warnings.push(`解析后仍有 ${blankPages.length} 个近空白页面，页码：${formatPages(blankPages)}`);
  return {
    extractionCompleteness,
    blankPageCount: blankPages.length,
    blankPages,
    skippedOcrPages,
    warning: warnings.join("；")
  };
}

async function defaultCreateOcrWorker(langPath) {
  return createWorker(["chi_sim", "eng"], 1, { langPath, cacheMethod: "none" });
}

async function defaultCreateLanguageDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "venture-lens-tesseract-"));
  await Promise.all([
    copyLanguageData(chiSimData, directory),
    copyLanguageData(engData, directory)
  ]);
  return { path: directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

async function copyLanguageData(language, directory) {
  const filename = `${language.code}.traineddata.gz`;
  await copyFile(path.join(language.langPath, filename), path.join(directory, filename));
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("PDF OCR 已取消");
  error.name = "AbortError";
  throw error;
}

function formatPages(pages) {
  return pages.slice(0, 20).join("、") + (pages.length > 20 ? "…" : "");
}

function joinWarnings(...values) {
  return values.map((value) => String(value || "").trim()).filter(Boolean).join("；");
}
