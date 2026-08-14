import { access, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export function createFileReviewRepository({ dataDir, now = () => new Date().toISOString() }) {
  const jobsDir = path.join(dataDir, "jobs");
  const reportsDir = path.join(dataDir, "reports");
  const uploadsDir = path.join(dataDir, "uploads");
  const pdfsDir = path.join(dataDir, "pdfs");
  const artifactsDir = path.join(dataDir, "artifacts");
  const deletedConversationsDir = path.join(dataDir, "deleted-conversations");
  const retentionTrashDir = path.join(dataDir, "retention-trash");
  const indexPath = path.join(dataDir, "job-index.json");
  const ownerOverrides = new Map();
  let index = new Map();
  let initialization;
  let indexWrite = Promise.resolve();

  function initialize() {
    if (!initialization) initialization = initializeOnce();
    return initialization;
  }

  async function initializeOnce() {
    await Promise.all([jobsDir, reportsDir, uploadsDir, pdfsDir, artifactsDir, deletedConversationsDir, retentionTrashDir]
      .map((directory) => mkdir(directory, { recursive: true })));
    index = await loadOrRebuildIndex();
  }

  async function save(job) {
    await initialize();
    const normalized = { ...job, ownerId: ownerOverrides.get(job.id) || job.ownerId, updatedAt: now() };
    const stored = await externalizeArtifacts(normalized);
    await writeAtomic(jobPath(normalized.id), JSON.stringify(stored, null, 2));
    index.set(normalized.id, indexRecord(normalized));
    await persistIndex();
    return normalized;
  }

  async function get(id) {
    await initialize();
    try {
      return hydrateArtifacts(JSON.parse(await readFile(jobPath(id), "utf8")));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function list({ limit = 30, ownerId } = {}) {
    await initialize();
    const selected = selectIndex({ limit, ownerId });
    const values = await Promise.all(selected.map((item) => get(item.id)));
    return values.filter(Boolean);
  }

  async function listSummaries({ limit = 30, ownerId } = {}) {
    await initialize();
    return selectIndex({ limit, ownerId }).map((item) => structuredClone(item));
  }

  async function assignUnowned(ownerId) {
    if (!ownerId) throw new Error("目标所有者不能为空");
    const unowned = selectIndex({ limit: 10000 }).filter((job) => !job.ownerId);
    for (const summary of unowned) await save({ ...(await get(summary.id)), ownerId });
    return unowned.length;
  }

  async function transferOwnership(fromOwnerId, toOwnerId) {
    if (!fromOwnerId || !toOwnerId || fromOwnerId === toOwnerId) return 0;
    const jobs = await list({ limit: 10000, ownerId: fromOwnerId });
    for (const job of jobs) {
      ownerOverrides.set(job.id, toOwnerId);
      await save({ ...job, ownerId: toOwnerId });
    }
    return jobs.length;
  }

  async function saveReport(id, markdown) {
    await initialize();
    const target = reportPath(id);
    await writeAtomic(target, String(markdown || ""));
    return target;
  }

  async function getReport(id) {
    try {
      return await readFile(reportPath(id), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return "";
      throw error;
    }
  }

  async function archiveReport(id) {
    const markdown = await getReport(id);
    if (!markdown) return "";
    const target = path.join(reportsDir, `${safeId(id)}.archive-${Date.now()}.md`);
    await writeAtomic(target, markdown);
    return target;
  }

  async function archiveConversation(id) {
    await initialize();
    const directory = path.join(deletedConversationsDir, formatUploadDate(now()));
    await mkdir(directory, { recursive: true });
    const suffix = `${safeId(id)}.${Date.now()}`;
    const movedJob = await moveIfPresent(jobPath(id), path.join(directory, `${suffix}.json`));
    await moveIfPresent(reportPath(id), path.join(directory, `${suffix}.md`));
    await moveIfPresent(path.join(artifactsDir, safeId(id)), path.join(directory, `${suffix}.artifacts`));
    index.delete(id);
    await persistIndex();
    return { archived: movedJob, uploadRetained: Boolean(await getUpload(id)), pdfRetained: Boolean(await getPdf(id)) };
  }

  async function archiveForRetention(id, { date = now() } = {}) {
    const job = await get(id);
    if (!job) return false;
    const directory = path.join(retentionTrashDir, formatUploadDate(date), safeId(id));
    await mkdir(directory, { recursive: true });
    await moveIfPresent(jobPath(id), path.join(directory, "job.json"));
    await moveIfPresent(reportPath(id), path.join(directory, "report.md"));
    await moveIfPresent(path.join(artifactsDir, safeId(id)), path.join(directory, "artifacts"));
    await moveAsset(uploadFilePath(id, job.upload?.storagePath), path.join(directory, "upload.source"));
    await moveAsset(pdfFilePath(id, job.pdfStoragePath), path.join(directory, "report.pdf"));
    index.delete(id);
    await persistIndex();
    return true;
  }

  async function archiveAssetsForRetention(job, directory) {
    await mkdir(directory, { recursive: true });
    const uploadMoved = await moveAsset(uploadFilePath(job.id, job.upload?.storagePath), path.join(directory, `${safeId(job.id)}.source`));
    const pdfMoved = await moveAsset(pdfFilePath(job.id, job.pdfStoragePath), path.join(directory, `${safeId(job.id)}.pdf`));
    return { uploadMoved, pdfMoved };
  }

  async function savePdf(id, buffer, { date = now() } = {}) {
    await initialize();
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("PDF 文件为空");
    const dateDirectory = formatUploadDate(date);
    const directory = path.join(pdfsDir, dateDirectory);
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, `${safeId(id)}.pdf`);
    await writeAtomic(target, buffer);
    return `${dateDirectory}/${safeId(id)}.pdf`;
  }

  async function getPdf(id, storagePath = "") {
    const target = await pdfFilePath(id, storagePath);
    return target ? readFile(target) : null;
  }

  async function hasPdf(id, storagePath = "") {
    return Boolean(await pdfFilePath(id, storagePath));
  }

  async function removePdf(id, storagePath = "") {
    const target = await pdfFilePath(id, storagePath);
    if (!target) return false;
    await unlink(target);
    return true;
  }

  async function saveUpload(id, buffer, { date = now() } = {}) {
    await initialize();
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("上传文件为空");
    const dateDirectory = formatUploadDate(date);
    const directory = path.join(uploadsDir, dateDirectory);
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, `${safeId(id)}.source`);
    await writeAtomic(target, buffer);
    return `${dateDirectory}/${safeId(id)}.source`;
  }

  async function getUpload(id, storagePath = "") {
    const target = await uploadFilePath(id, storagePath);
    return target ? readFile(target) : null;
  }

  async function loadOrRebuildIndex() {
    try {
      const parsed = JSON.parse(await readFile(indexPath, "utf8"));
      if (!Array.isArray(parsed.jobs)) throw new Error("invalid job index");
      return new Map(parsed.jobs.map((item) => [item.id, item]));
    } catch {
      const names = (await readdir(jobsDir)).filter((name) => name.endsWith(".json"));
      const records = await Promise.all(names.map(async (name) => {
        try {
          return indexRecord(JSON.parse(await readFile(path.join(jobsDir, name), "utf8")));
        } catch {
          return null;
        }
      }));
      const rebuilt = new Map(records.filter(Boolean).map((item) => [item.id, item]));
      await writeAtomic(indexPath, JSON.stringify({ version: 1, jobs: [...rebuilt.values()] }, null, 2));
      return rebuilt;
    }
  }

  function selectIndex({ limit, ownerId } = {}) {
    return [...index.values()]
      .filter((job) => ownerId === undefined || job.ownerId === ownerId)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, Math.max(0, Number(limit) || 0));
  }

  function persistIndex() {
    indexWrite = indexWrite.then(() => writeAtomic(indexPath, JSON.stringify({ version: 1, jobs: [...index.values()] }, null, 2)));
    return indexWrite;
  }

  async function externalizeArtifacts(job) {
    const checkpoints = await persistCheckpointSet(job.id, job.checkpoints, "pipeline");
    const refreshCheckpoints = await persistCheckpointSet(job.id, job.evidenceRefresh?.checkpoints, "refresh");
    return {
      ...job,
      checkpoints,
      ...(job.evidenceRefresh ? { evidenceRefresh: { ...job.evidenceRefresh, checkpoints: refreshCheckpoints } } : {})
    };
  }

  async function persistCheckpointSet(id, checkpoints = {}, scope) {
    const values = {};
    for (const [key, checkpoint] of Object.entries(checkpoints || {})) {
      const artifact = checkpoint?.artifact;
      if (!artifact || !Object.keys(artifact).length) {
        values[key] = { ...checkpoint, artifact: artifact || {} };
        continue;
      }
      const relative = `${safeId(id)}/${scope}-${safeStep(key)}.json`;
      const target = path.join(artifactsDir, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeAtomic(target, JSON.stringify(artifact));
      const { artifact: _omitted, ...metadata } = checkpoint;
      values[key] = { ...metadata, artifactPath: relative };
    }
    return values;
  }

  async function hydrateArtifacts(job) {
    const checkpoints = await hydrateCheckpointSet(job.checkpoints);
    const refreshCheckpoints = await hydrateCheckpointSet(job.evidenceRefresh?.checkpoints);
    return {
      ...job,
      checkpoints,
      ...(job.evidenceRefresh ? { evidenceRefresh: { ...job.evidenceRefresh, checkpoints: refreshCheckpoints } } : {})
    };
  }

  async function hydrateCheckpointSet(checkpoints = {}) {
    const values = {};
    for (const [key, checkpoint] of Object.entries(checkpoints || {})) {
      if (!checkpoint?.artifactPath) {
        values[key] = checkpoint;
        continue;
      }
      const target = safeArtifactPath(checkpoint.artifactPath);
      let artifact = {};
      try {
        artifact = JSON.parse(await readFile(target, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      values[key] = { ...checkpoint, artifact };
    }
    return values;
  }

  async function uploadFilePath(id, storagePath = "") {
    const candidates = [];
    if (/^\d{8}\/[a-zA-Z0-9_-]+\.source$/.test(storagePath)) candidates.push(path.join(uploadsDir, storagePath));
    candidates.push(path.join(uploadsDir, `${safeId(id)}.source`));
    return await firstExisting(candidates) || findDatedFile(uploadsDir, id, ".source");
  }

  async function pdfFilePath(id, storagePath = "") {
    const candidates = [];
    if (/^\d{8}\/[a-zA-Z0-9_-]+\.pdf$/.test(storagePath)) candidates.push(path.join(pdfsDir, storagePath));
    return await firstExisting(candidates) || findDatedFile(pdfsDir, id, ".pdf");
  }

  async function findDatedFile(root, id, extension) {
    const directories = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && /^\d{8}$/.test(entry.name));
    return firstExisting(directories.sort((a, b) => b.name.localeCompare(a.name)).map((directory) => path.join(root, directory.name, `${safeId(id)}${extension}`)));
  }

  async function firstExisting(candidates) {
    for (const target of candidates) {
      try {
        await access(target);
        return target;
      } catch {}
    }
    return "";
  }

  function safeArtifactPath(relative) {
    if (!/^[a-zA-Z0-9_-]+\/(?:pipeline|refresh)-[a-zA-Z0-9_-]+\.json$/.test(relative)) throw new Error("无效 checkpoint artifact 路径");
    return path.join(artifactsDir, relative);
  }

  function jobPath(id) { return path.join(jobsDir, `${safeId(id)}.json`); }
  function reportPath(id) { return path.join(reportsDir, `${safeId(id)}.md`); }

  return {
    archiveAssetsForRetention, archiveConversation, archiveForRetention, archiveReport, assignUnowned, get, getPdf, getReport, getUpload,
    hasPdf, initialize, list, listSummaries, removePdf, save, savePdf, saveReport, saveUpload, transferOwnership
  };
}

function indexRecord(job) {
  return {
    id: job.id,
    ownerId: job.ownerId || "",
    taskType: job.taskType,
    companyName: job.companyName,
    title: job.title,
    instruction: job.instruction,
    outputLanguage: job.outputLanguage,
    status: job.status,
    reportAvailable: Boolean(job.reportAvailable),
    upload: job.upload ? { filename: job.upload.filename, mimeType: job.upload.mimeType, size: job.upload.size, sha256: job.upload.sha256 } : null,
    evidenceRefresh: job.evidenceRefresh ? { status: job.evidenceRefresh.status } : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt
  };
}

async function writeAtomic(target, content) {
  const temporary = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, target);
}

async function moveIfPresent(source, target) {
  try {
    await rename(source, target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function moveAsset(sourcePromise, target) {
  const source = await sourcePromise;
  return source ? moveIfPresent(source, target) : false;
}

export async function removeTree(target) {
  await rm(target, { recursive: true, force: true });
}

export function formatUploadDate(value, timeZone = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}${get("month")}${get("day")}`;
}

function safeId(value) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9_-]{6,100}$/.test(id)) throw new Error("无效任务 ID");
  return id;
}

function safeStep(value) {
  const key = String(value || "");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(key)) throw new Error("无效流水线步骤");
  return key;
}
