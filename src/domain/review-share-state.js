import { createHash } from "node:crypto";

export function reviewContentVersion(review, report) {
  const uploads = Array.isArray(review?.uploads) && review.uploads.length ? review.uploads : review?.upload ? [review.upload] : [];
  const content = {
    taskType: review?.taskType || "attachment_review",
    companyName: review?.companyName || "",
    title: review?.title || "",
    instruction: review?.instruction || "",
    outputLanguage: review?.outputLanguage || "zh",
    upload: uploads[0] ? { filename: uploads[0].filename || "", sha256: uploads[0].sha256 || "" } : null,
    ...(uploads.length > 1 ? { uploads: uploads.map((upload) => ({ filename: upload.filename || "", sha256: upload.sha256 || "" })) } : {}),
    report: String(report || ""),
    messages: Array.isArray(review?.messages) ? review.messages.map(({ role, content, status }) => ({ role, content, status })) : [],
    quality: review?.quality || null,
    lastEvidenceRefresh: review?.lastEvidenceRefresh || null
  };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export function forkSharedReview(review, reason, at) {
  if (!review?.shareOrigin || review.shareOrigin.forkedAt) return review;
  return {
    ...review,
    shareOrigin: {
      ...review.shareOrigin,
      forkedAt: String(at || ""),
      forkReason: String(reason || "content_change")
    }
  };
}

export function isPristineSharedReview(review) {
  return Boolean(review?.shareOrigin?.sourceReviewId && review.shareOrigin.sourceVersion && !review.shareOrigin.forkedAt);
}
