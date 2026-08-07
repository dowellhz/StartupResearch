import test from "node:test";
import assert from "node:assert/strict";
import { meaningfulCharacterCount, mergePageText, removeRepeatedPdfWatermarks } from "../src/infra/pdf-watermark-cleaner.js";
import { assessPageExtraction, createPdfOcrService, imageHeavyPages, needsConditionalOcr, selectImageCheckPages, selectOcrTargets } from "../src/infra/pdf-ocr-service.js";

test("repeated watermark lines are removed without discarding unique page content", () => {
  const result = removeRepeatedPdfWatermarks([
    { page: 1, text: "机密资料 CONFIDENTIAL\n第一页核心内容" },
    { page: 2, text: "机密资料 CONFIDENTIAL\n第二页财务数据" },
    { page: 3, text: "机密资料 CONFIDENTIAL\n第三页融资计划" },
    { page: 4, text: "机密资料 CONFIDENTIAL\n第四页团队信息" }
  ]);
  assert.equal(result.removedLineCount, 4);
  assert.doesNotMatch(result.pages[0].text, /CONFIDENTIAL/);
  assert.match(result.pages[0].text, /第一页核心内容/);
  assert.match(result.pages[3].text, /第四页团队信息/);
});

test("OCR text adds missing visual content and target selection is budgeted", () => {
  const merged = mergePageText("产品参数\n比表面积 1200", "产品参数\n灰分 0.5%\n比表面积 1200");
  assert.equal((merged.match(/产品参数/g) || []).length, 1);
  assert.match(merged, /灰分 0.5%/);
  assert.deepEqual(selectOcrTargets([
    { page: 1, text: "短" },
    { page: 2, text: "足够完整的文字".repeat(60) },
    { page: 3, text: "图表" }
  ], { textThreshold: 20, maxOcrPages: 1 }), [1]);
  assert.equal(meaningfulCharacterCount("数 据：120"), 5);
});

test("OCR skips complete short native text and keeps blank, visual, or corrupted pages", () => {
  const normalText = "这是一页已经能够完整读取的原生文字内容，包含产品介绍、团队信息和市场说明。".repeat(2);
  assert.ok(meaningfulCharacterCount(normalText) >= 40);
  assert.ok(meaningfulCharacterCount(normalText) < 120);
  assert.equal(needsConditionalOcr(normalText), false);
  assert.equal(needsConditionalOcr("产品架构图\n核心模块"), true);
  assert.deepEqual(selectOcrTargets([
    { page: 1, text: normalText },
    { page: 2, text: "" },
    { page: 3, text: "产品架构图\n核心模块与数据流程说明".repeat(3) },
    { page: 4, text: `识别异常��${"内容".repeat(25)}` },
    { page: 5, text: "完整正文".repeat(40) }
  ]), [2, 3, 4]);
  assert.deepEqual(selectImageCheckPages([
    { page: 1, text: normalText },
    { page: 2, text: "" },
    { page: 3, text: "完整正文".repeat(40) }
  ]), [1]);
  assert.deepEqual(imageHeavyPages({ pages: [
    { pageNumber: 1, images: [{ width: 80, height: 80 }] },
    { pageNumber: 2, images: [{ width: 800, height: 500 }] }
  ] }), [2]);
});

test("page extraction assessment reports blank and skipped OCR pages", () => {
  const result = assessPageExtraction([
    { page: 1, text: "完整业务内容".repeat(20) },
    { page: 2, text: "" },
    { page: 3, text: "少量" }
  ], { pageCount: 3, skippedOcrPages: [3] });
  assert.deepEqual(result.blankPages, [2, 3]);
  assert.deepEqual(result.skippedOcrPages, [3]);
  assert.ok(result.extractionCompleteness < 1);
  assert.match(result.warning, /超出 OCR 预算/);
  assert.match(result.warning, /近空白页面/);
});

test("OCR renders large target sets in bounded batches", async () => {
  const batches = [];
  const parser = {
    getScreenshot: async ({ partial }) => {
      batches.push(partial);
      return { pages: partial.map((page) => ({ pageNumber: page, data: Buffer.from(`page-${page}`) })) };
    },
    destroy: async () => {}
  };
  const worker = {
    recognize: async (buffer) => ({ data: { text: `识别内容 ${buffer.toString()}` } }),
    terminate: async () => {}
  };
  const service = createPdfOcrService({
    createParser: () => parser,
    createOcrWorker: async () => worker,
    createLanguageDirectory: async () => ({ path: "/tmp/mock", cleanup: async () => {} }),
    renderBatchSize: 2,
    maxOcrPages: 5,
    textThreshold: 20
  });
  const pages = Array.from({ length: 5 }, (_, index) => ({ page: index + 1, text: "" }));
  const result = await service.enhance({ buffer: Buffer.from("pdf"), pages, pageCount: 5 });
  assert.equal(result.ocrPageCount, 5);
  assert.equal(result.ocrUsefulPageCount, 5);
  assert.deepEqual(batches, [[1, 3], [2, 4], [5]]);
  assert.equal(batches.every((batch) => batch.length <= 2), true);
});

test("OCR probe stops remaining candidates when it adds no useful text", async () => {
  const batches = [];
  const pages = Array.from({ length: 6 }, (_, index) => ({ page: index + 1, text: "" }));
  const service = createPdfOcrService({
    createParser: () => ({
      getScreenshot: async ({ partial }) => {
        batches.push(partial);
        return { pages: partial.map((page) => ({ pageNumber: page, data: Buffer.from(`page-${page}`) })) };
      },
      destroy: async () => {}
    }),
    createOcrWorker: async () => ({ recognize: async () => ({ data: { text: "" } }), terminate: async () => {} }),
    createLanguageDirectory: async () => ({ path: "/tmp/mock", cleanup: async () => {} }),
    renderBatchSize: 2,
    maxOcrPages: 6,
    probePageCount: 2
  });
  const progress = [];
  const result = await service.enhance({ buffer: Buffer.from("pdf"), pages, pageCount: 6 }, { onProgress: ({ message }) => progress.push(message) });
  assert.equal(result.ocrCandidatePageCount, 6);
  assert.equal(result.ocrPageCount, 2);
  assert.equal(result.ocrUsefulPageCount, 0);
  assert.equal(result.ocrSkippedAfterProbe.length, 4);
  assert.deepEqual(batches, [[1, 4]]);
  assert.ok(progress.some((message) => message.includes("已跳过剩余 4 页")));
});

test("OCR avoids pdf-parse image probing and directly budgets low-density pages", async () => {
  let imageProbeCalls = 0;
  const service = createPdfOcrService({
    createParser: () => ({
      getImage: async () => { imageProbeCalls += 1; throw new Error("unsafe image probe"); },
      getScreenshot: async ({ partial }) => ({ pages: partial.map((page) => ({ pageNumber: page, data: Buffer.from(`page-${page}`) })) }),
      destroy: async () => {}
    }),
    createOcrWorker: async () => ({ recognize: async () => ({ data: { text: "OCR 补充内容" } }), terminate: async () => {} }),
    createLanguageDirectory: async () => ({ path: "/tmp/mock", cleanup: async () => {} }),
    directTextThreshold: 40,
    textThreshold: 120
  });
  const result = await service.enhance({
    buffer: Buffer.from("pdf"),
    pages: [{ page: 1, text: "原生文字内容".repeat(12) }],
    pageCount: 1
  });
  assert.equal(imageProbeCalls, 0);
  assert.equal(result.ocrPageCount, 1);
});
