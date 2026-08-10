import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { PDF_FONT_NAMES, registerPdfFonts, resolveBundledPdfFonts, setPdfFont } from "../src/infra/pdf-font-service.js";
import { createPdfReportService } from "../src/infra/pdf-report-service.js";

test("PDF fonts resolve and register the deterministic bundled Source Han family", () => {
  const fonts = resolveBundledPdfFonts({ fontDir: "/app/assets/fonts", existsSync: () => true });
  assert.equal(fonts.sans, path.join("/app/assets/fonts", "SourceHanSansSC-Regular.otf"));
  const registered = [];
  const selected = [];
  const doc = {
    registerFont: (...args) => registered.push(args),
    font: (name) => { selected.push(name); return doc; }
  };
  registerPdfFonts(doc, fonts);
  setPdfFont(doc, { role: "body" });
  setPdfFont(doc, { role: "sans", bold: true });
  assert.deepEqual(registered.map(([name]) => name), [PDF_FONT_NAMES.sans, PDF_FONT_NAMES.sansBold, PDF_FONT_NAMES.serif]);
  assert.deepEqual(selected, [PDF_FONT_NAMES.serif, PDF_FONT_NAMES.sansBold]);
});

test("PDF report renders Chinese Markdown with the bundled fonts", async () => {
  const service = createPdfReportService({ now: () => "2026-08-04T12:00:00.000Z" });
  const buffer = await service.render({ title: "示例 BP 核查报告", markdown: "**总判断**：需要继续核查。\n\n## 团队\n\n#### 主题一：AI 数学教育\n\n- 创始团队背景待验证" });
  assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
  assert.ok(buffer.length > 1000);
});

test("whole conversation PDF renders web-like request, report and follow-up cards", async () => {
  const service = createPdfReportService({ now: () => "2026-08-05T12:00:00.000Z" });
  const buffer = await service.renderConversation({
    title: "示例科技 · 完整对话",
    companyName: "示例科技",
    taskType: "company_pre_research",
    status: "completed",
    request: { instruction: "关注团队和产品", attachment: null },
    stages: [{ label: "抓取公司公开信息", status: "completed" }],
    reportLabel: "公司预研报告",
    report: "# 示例科技公司预研\n\n## 预研结论\n\n**总判断**：建议继续核查。\n\n| 维度 | 判断 |\n|---|---|\n| 团队 | 待验证 |",
    quality: { ok: true, score: 82 },
    evidenceRefresh: { title: "公开资料刷新", report: "## 刷新结论\n\n未发现重大变化。" },
    messages: [
      { role: "user", content: "最大的风险是什么？" },
      { role: "assistant", content: "客户证据仍然不足，建议补充合同。" }
    ]
  });
  assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
  assert.ok(buffer.length > 3000);
});
