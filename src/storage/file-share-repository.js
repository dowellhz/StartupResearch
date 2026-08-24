import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function createFileShareRepository({ dataDir }) {
  const sharesDir = path.join(dataDir, "shares");

  async function save(share) {
    await mkdir(sharesDir, { recursive: true });
    const normalized = {
      id: normalizeShareId(share.id),
      sourceReviewId: normalizeReviewId(share.sourceReviewId),
      createdAt: String(share.createdAt || "")
    };
    await writeAtomic(sharePath(normalized.id), JSON.stringify(normalized, null, 2));
    return normalized;
  }

  async function get(id) {
    const normalizedId = normalizeShareId(id);
    try {
      return JSON.parse(await readFile(sharePath(normalizedId), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  function sharePath(id) {
    return path.join(sharesDir, `${normalizeShareId(id)}.json`);
  }

  return { get, save };
}

function normalizeShareId(value) {
  const id = String(value || "");
  if (!/^share_[a-zA-Z0-9_-]{32,100}$/.test(id)) throw Object.assign(new Error("分享链接无效"), { statusCode: 404 });
  return id;
}

function normalizeReviewId(value) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9_-]{6,100}$/.test(id)) throw new Error("无效任务 ID");
  return id;
}

async function writeAtomic(target, content) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, target);
}
