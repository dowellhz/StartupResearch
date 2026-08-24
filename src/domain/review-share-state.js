import { createHash } from "node:crypto";

export function reviewContentVersion(review, report) {
  const content = {
    taskType: review?.taskType || "attachment_review",
    companyName: review?.companyName || "",
    title: review?.title || "",
    instruction: review?.instruction || "",
    outputLanguage: review?.outputLanguage || "zh",
    upload: review?.upload ? {
      filename: review.upload.filename || "",
      sha256: review.upload.sha256 || ""
    } : null,
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
