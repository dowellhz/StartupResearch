import { createHash } from "node:crypto";

export function createLazyPdfService({ repository, pdf, titleFor } = {}) {
  const pending = new Map();

  async function getOrRender(review) {
    const reportHash = createHash("sha256").update(String(review.report || "")).digest("hex");
    const stored = review.pdfReportHash === reportHash ? await repository.getPdf(review.id, review.pdfStoragePath) : null;
    if (stored) return stored;
    if (pending.has(review.id)) return pending.get(review.id);
    const promise = (async () => {
      const buffer = await pdf.render({ title: titleFor(review), markdown: review.report });
      const pdfStoragePath = await repository.savePdf(review.id, buffer, { date: review.createdAt || review.completedAt });
      const job = await repository.get(review.id);
      if (job) await repository.save({ ...job, pdfStoragePath, pdfReportHash: reportHash });
      return buffer;
    })().finally(() => pending.delete(review.id));
    pending.set(review.id, promise);
    return promise;
  }

  return { getOrRender };
}
