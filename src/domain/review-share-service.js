import { randomBytes, randomUUID } from "node:crypto";
import { assertOwnerId, publicJob } from "./review-manager-support.js";

export function createReviewShareService({ repository, shareRepository, logger = {}, now = () => new Date().toISOString(), createShareId = defaultShareId, createReviewId = defaultReviewId }) {
  const pendingImports = new Map();

  async function create(reviewId, { ownerId } = {}) {
    assertOwnerId(ownerId);
    const source = await requireReview(reviewId);
    if (source.ownerId !== ownerId) throw notFound("未找到该核查任务");
    if (["queued", "running"].includes(source.status) || ["queued", "running"].includes(source.evidenceRefresh?.status)) {
      throw Object.assign(new Error("研究或资料刷新完成后才能分享"), { statusCode: 409 });
    }
    const report = await repository.getReport(reviewId);
    if (!source.reportAvailable || !String(report || "").trim()) {
      throw Object.assign(new Error("报告生成后才能分享"), { statusCode: 409 });
    }
    const share = await shareRepository.save({ id: createShareId(), sourceReviewId: reviewId, createdAt: now() });
    await logger.audit?.("review.share_created", { jobId: reviewId, ownerId, shareId: share.id });
    return { id: share.id, path: `/share/${share.id}` };
  }

  async function importReview(shareId, { ownerId } = {}) {
    assertOwnerId(ownerId);
    const key = `${ownerId}:${shareId}`;
    if (pendingImports.has(key)) return pendingImports.get(key);
    const promise = importOnce(shareId, ownerId).finally(() => pendingImports.delete(key));
    pendingImports.set(key, promise);
    return promise;
  }

  async function importOnce(shareId, ownerId) {
    const existing = (await repository.list({ ownerId, limit: 10000 }))
      .find((job) => job.shareOrigin?.shareId === shareId);
    if (existing) return { review: publicJob(existing), imported: false };

    const share = await shareRepository.get(shareId);
    if (!share) throw notFound("分享链接无效或已失效");
    const source = await requireReview(share.sourceReviewId);
    const report = await repository.getReport(source.id);
    if (!String(report || "").trim()) throw notFound("分享的报告已不存在");

    const importedAt = now();
    const id = createReviewId();
    const upload = await copyUpload(source, id, importedAt);
    const pdfStoragePath = await copyPdf(source, id, importedAt);
    await repository.saveReport(id, report);
    const clone = await repository.save({
      ...structuredClone(source),
      id,
      ownerId,
      upload,
      pdfStoragePath,
      reportAvailable: true,
      createdAt: importedAt,
      updatedAt: importedAt,
      shareOrigin: { shareId: share.id, sourceReviewId: source.id, importedAt },
      previousReportArchive: ""
    });
    await logger.audit?.("review.share_imported", { jobId: id, ownerId, shareId: share.id });
    return { review: publicJob(clone), imported: true };
  }

  async function copyUpload(source, targetId, date) {
    if (!source.upload) return null;
    const buffer = await repository.getUpload?.(source.id, source.upload.storagePath);
    const storagePath = buffer?.length ? await repository.saveUpload(targetId, buffer, { date }) : "";
    return { ...source.upload, data: "", persisted: Boolean(storagePath), storagePath };
  }

  async function copyPdf(source, targetId, date) {
    if (!source.pdfStoragePath) return "";
    const buffer = await repository.getPdf?.(source.id, source.pdfStoragePath);
    return buffer?.length ? repository.savePdf(targetId, buffer, { date }) : "";
  }

  async function requireReview(id) {
    const review = await repository.get(id);
    if (!review) throw notFound("分享的研究条目已不存在");
    return review;
  }

  return { create, importReview };
}

function defaultShareId() {
  return `share_${randomBytes(24).toString("base64url")}`;
}

function defaultReviewId() {
  return `copy_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function notFound(message) {
  return Object.assign(new Error(message), { statusCode: 404 });
}
