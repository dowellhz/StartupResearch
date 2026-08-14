export function createLazyPdfService({ repository, pdf, titleFor } = {}) {
  const pending = new Map();

  async function getOrRender(review) {
    const stored = await repository.getPdf(review.id, review.pdfStoragePath);
    if (stored) return stored;
    if (pending.has(review.id)) return pending.get(review.id);
    const promise = (async () => {
      const buffer = await pdf.render({ title: titleFor(review), markdown: review.report });
      const pdfStoragePath = await repository.savePdf(review.id, buffer, { date: review.createdAt || review.completedAt });
      const job = await repository.get(review.id);
      if (job) await repository.save({ ...job, pdfStoragePath });
      return buffer;
    })().finally(() => pending.delete(review.id));
    pending.set(review.id, promise);
    return promise;
  }

  return { getOrRender };
}
