import { createHash } from "node:crypto";

export const MAX_REVIEW_UPLOADS = 8;

export function prepareReviewUploadSet({ upload, uploads } = {}) {
  const values = Array.isArray(uploads) && uploads.length ? uploads : upload ? [upload] : [];
  if (!values.length || values.some((item) => !item?.data || !item?.filename)) throw new Error("请先上传商业计划书");
  if (values.length > MAX_REVIEW_UPLOADS) throw new Error(`首次最多上传 ${MAX_REVIEW_UPLOADS} 份资料`);
  const entries = values.map((item) => {
    const buffer = Buffer.from(item.data, "base64");
    if (!buffer.length) throw new Error("上传文件为空");
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    return { upload: { ...item, sha256 }, buffer };
  });
  if (entries.length === 1) return { entries, hash: entries[0].upload.sha256 };
  const uploadSetHash = createHash("sha256");
  entries.forEach(({ upload: item }) => uploadSetHash.update(`${item.sha256}\n`));
  return { entries, hash: uploadSetHash.digest("hex") };
}

export async function persistReviewUploadSet({ repository, jobId, entries }) {
  if (typeof repository.saveUpload !== "function") return entries.map(({ upload }) => upload);
  const multiple = entries.length > 1;
  return Promise.all(entries.map(async ({ upload, buffer }, index) => {
    const storagePath = await repository.saveUpload(jobId, buffer, multiple ? { slot: index } : {});
    return { ...upload, data: "", persisted: true, storagePath };
  }));
}

export function reviewUploads(job) {
  return Array.isArray(job?.uploads) && job.uploads.length ? job.uploads : job?.upload ? [job.upload] : [];
}
