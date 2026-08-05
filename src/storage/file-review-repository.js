import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function createFileReviewRepository({ dataDir, now = () => new Date().toISOString() }) {
  const jobsDir = path.join(dataDir, "jobs");
  const reportsDir = path.join(dataDir, "reports");
  const uploadsDir = path.join(dataDir, "uploads");
  const pdfsDir = path.join(dataDir, "pdfs");
  const deletedConversationsDir = path.join(dataDir, "deleted-conversations");

  async function initialize() {
    await Promise.all([
      mkdir(jobsDir, { recursive: true }),
      mkdir(reportsDir, { recursive: true }),
      mkdir(uploadsDir, { recursive: true }),
      mkdir(pdfsDir, { recursive: true }),
      mkdir(deletedConversationsDir, { recursive: true })
    ]);
  }

  async function save(job) {
    await initialize();
    const normalized = { ...job, updatedAt: now() };
    const target = jobPath(normalized.id);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(normalized, null, 2), "utf8");
    await rename(temporary, target);
    return normalized;
  }

  async function get(id) {
    try {
      return JSON.parse(await readFile(jobPath(id), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function list({ limit = 30, ownerId } = {}) {
    await initialize();
    const names = (await readdir(jobsDir)).filter((name) => name.endsWith(".json"));
    const values = await Promise.all(names.map(async (name) => {
      try {
        return JSON.parse(await readFile(path.join(jobsDir, name), "utf8"));
      } catch {
        return null;
      }
    }));
    return values
      .filter((job) => job && (ownerId === undefined || job.ownerId === ownerId))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, limit);
  }

  async function claimUnowned(ownerId) {
    if (!ownerId) throw new Error("匿名浏览器身份不能为空");
    const jobs = await list({ limit: 10000 });
    const unowned = jobs.filter((job) => !job.ownerId);
    for (const job of unowned) await save({ ...job, ownerId });
    return unowned.length;
  }

  async function saveReport(id, markdown) {
    await initialize();
    const target = reportPath(id);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, String(markdown || ""), "utf8");
    await rename(temporary, target);
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
    const filename = `${safeId(id)}.archive-${Date.now()}.md`;
    const target = path.join(reportsDir, filename);
    await writeFile(target, markdown, "utf8");
    return target;
  }

  async function archiveConversation(id) {
    await initialize();
    const directory = path.join(deletedConversationsDir, formatUploadDate(now()));
    await mkdir(directory, { recursive: true });
    const suffix = `${safeId(id)}.${Date.now()}`;
    const movedJob = await moveIfPresent(jobPath(id), path.join(directory, `${suffix}.json`));
    await moveIfPresent(reportPath(id), path.join(directory, `${suffix}.md`));
    return { archived: movedJob, uploadRetained: Boolean(await getUpload(id)), pdfRetained: Boolean(await getPdf(id)) };
  }

  async function savePdf(id, buffer, { date = now() } = {}) {
    await initialize();
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("PDF 文件为空");
    const dateDirectory = formatUploadDate(date);
    const directory = path.join(pdfsDir, dateDirectory);
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, `${safeId(id)}.pdf`);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, buffer);
    await rename(temporary, target);
    return `${dateDirectory}/${safeId(id)}.pdf`;
  }

  async function getPdf(id, storagePath = "") {
    const candidates = [];
    if (storagePath && /^\d{8}\/[a-zA-Z0-9_-]+\.pdf$/.test(storagePath)) candidates.push(path.join(pdfsDir, storagePath));
    for (const target of candidates) {
      try {
        return await readFile(target);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return findDatedPdf(id);
  }

  async function saveUpload(id, buffer, { date = now() } = {}) {
    await initialize();
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("上传文件为空");
    const dateDirectory = formatUploadDate(date);
    const directory = path.join(uploadsDir, dateDirectory);
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, `${safeId(id)}.source`);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, buffer);
    await rename(temporary, target);
    return `${dateDirectory}/${safeId(id)}.source`;
  }

  async function getUpload(id, storagePath = "") {
    const candidates = [];
    if (storagePath && /^\d{8}\/[a-zA-Z0-9_-]+\.source$/.test(storagePath)) {
      candidates.push(path.join(uploadsDir, storagePath));
    }
    candidates.push(uploadPath(id));
    for (const target of candidates) {
      try {
        return await readFile(target);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return findDatedUpload(id);
  }

  async function findDatedUpload(id) {
    const directories = (await readdir(uploadsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory() && /^\d{8}$/.test(entry.name));
    for (const directory of directories.sort((a, b) => b.name.localeCompare(a.name))) {
      try {
        return await readFile(path.join(uploadsDir, directory.name, `${safeId(id)}.source`));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return null;
  }

  async function findDatedPdf(id) {
    const directories = (await readdir(pdfsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory() && /^\d{8}$/.test(entry.name));
    for (const directory of directories.sort((a, b) => b.name.localeCompare(a.name))) {
      try {
        return await readFile(path.join(pdfsDir, directory.name, `${safeId(id)}.pdf`));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return null;
  }

  function jobPath(id) {
    return path.join(jobsDir, `${safeId(id)}.json`);
  }

  function reportPath(id) {
    return path.join(reportsDir, `${safeId(id)}.md`);
  }

  function uploadPath(id) {
    return path.join(uploadsDir, `${safeId(id)}.source`);
  }

  return { archiveConversation, archiveReport, claimUnowned, get, getPdf, getReport, getUpload, initialize, list, save, savePdf, saveReport, saveUpload };
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
