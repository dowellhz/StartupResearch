import test from "node:test";
import assert from "node:assert/strict";
import { createLazyPdfService } from "../src/domain/lazy-pdf-service.js";

test("lazy PDF rendering reuses stored output and deduplicates concurrent first downloads", async () => {
  let renders = 0;
  let stored = null;
  let job = { id: "bp_lazy_pdf", report: "# report" };
  const repository = {
    getPdf: async () => stored,
    savePdf: async (_id, buffer) => { stored = buffer; return "20260814/bp_lazy_pdf.pdf"; },
    get: async () => job,
    save: async (value) => { job = value; return value; }
  };
  const pdf = { render: async () => { renders += 1; await Promise.resolve(); return Buffer.from("pdf"); } };
  const service = createLazyPdfService({ repository, pdf, titleFor: () => "Title" });
  const [first, second] = await Promise.all([service.getOrRender(job), service.getOrRender(job)]);
  assert.equal(first.toString(), "pdf");
  assert.equal(second.toString(), "pdf");
  assert.equal(renders, 1);
  assert.equal(job.pdfStoragePath, "20260814/bp_lazy_pdf.pdf");
  await service.getOrRender(job);
  assert.equal(renders, 1);
});

test("legacy cached PDFs are regenerated from the report with resolved citations", async () => {
  let job = { id: "legacy", pdfStoragePath: "old.pdf", report: "Report [来源 19](https://example.com/)" };
  let rendered = "";
  const service = createLazyPdfService({
    repository: {
      getPdf: async () => Buffer.from("old PDF without links"),
      savePdf: async () => "new.pdf",
      get: async () => job,
      save: async (value) => { job = value; }
    },
    pdf: { render: async ({ markdown }) => { rendered = markdown; return Buffer.from("new PDF"); } },
    titleFor: () => "Title"
  });
  const result = await service.getOrRender(job);
  assert.equal(result.toString(), "new PDF");
  assert.equal(rendered, job.report);
  assert.ok(job.pdfReportHash);
  assert.equal(job.pdfStoragePath, "new.pdf");
});
