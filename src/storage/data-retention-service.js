import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const TERMINAL = new Set(["completed", "needs_attention", "failed"]);

export function createDataRetentionService({ dataDir, repository, retentionDays = 0, graceDays = 7, now = () => new Date(), logger } = {}) {
  async function cleanup() {
    if (!(retentionDays > 0)) return { enabled: false, archivedJobs: 0, archivedDeletedGroups: 0, purgedTrashGroups: 0 };
    const current = new Date(now());
    const cutoff = current.getTime() - retentionDays * 86_400_000;
    const today = dateKey(current);
    const trashRoot = path.join(dataDir, "retention-trash");
    const trashToday = path.join(trashRoot, today);
    await mkdir(trashToday, { recursive: true });

    let archivedJobs = 0;
    const jobs = await repository.listSummaries({ limit: 100000 });
    for (const job of jobs) {
      if (!TERMINAL.has(job.status) || timestamp(job.updatedAt) >= cutoff) continue;
      if (await repository.archiveForRetention(job.id, { date: current })) archivedJobs += 1;
    }

    const archivedDeletedGroups = await archiveDeletedConversations({ dataDir, repository, cutoff, trashToday });
    const archivedReportVersions = await archiveOldReportVersions({ dataDir, cutoff, trashToday });
    const archivedLogs = await archiveOldLogs({ dataDir, cutoff, trashToday });
    const purgedTrashGroups = await purgeOldTrash(trashRoot, current.getTime() - graceDays * 86_400_000, today);
    const result = { enabled: true, archivedJobs, archivedDeletedGroups, archivedReportVersions, archivedLogs, purgedTrashGroups };
    await logger?.audit?.("retention.cleanup", result);
    return result;
  }

  return { cleanup };
}

async function archiveDeletedConversations({ dataDir, repository, cutoff, trashToday }) {
  const root = path.join(dataDir, "deleted-conversations");
  let count = 0;
  for (const entry of await safeReadDir(root)) {
    if (!entry.isDirectory() || !/^\d{8}$/.test(entry.name) || dateTimestamp(entry.name) >= cutoff) continue;
    const source = path.join(root, entry.name);
    const target = path.join(trashToday, `deleted-${entry.name}`);
    const assets = path.join(target, "assets");
    await mkdir(assets, { recursive: true });
    for (const file of (await safeReadDir(source)).filter((item) => item.isFile() && item.name.endsWith(".json"))) {
      try {
        const job = JSON.parse(await readFile(path.join(source, file.name), "utf8"));
        await repository.archiveAssetsForRetention(job, assets);
      } catch {}
    }
    await rename(source, path.join(target, "conversation"));
    count += 1;
  }
  return count;
}

async function archiveOldReportVersions({ dataDir, cutoff, trashToday }) {
  const root = path.join(dataDir, "reports");
  const target = path.join(trashToday, "report-versions");
  let count = 0;
  for (const entry of await safeReadDir(root)) {
    if (!entry.isFile() || !/\.archive-\d+\.md$/.test(entry.name)) continue;
    const source = path.join(root, entry.name);
    if ((await stat(source)).mtimeMs >= cutoff) continue;
    await mkdir(target, { recursive: true });
    await rename(source, path.join(target, entry.name));
    count += 1;
  }
  return count;
}

async function archiveOldLogs({ dataDir, cutoff, trashToday }) {
  const root = path.join(dataDir, "logs");
  const target = path.join(trashToday, "logs");
  let count = 0;
  for (const entry of await safeReadDir(root)) {
    if (!entry.isFile() || !/\.jsonl$/.test(entry.name)) continue;
    const source = path.join(root, entry.name);
    if ((await stat(source)).mtimeMs >= cutoff) continue;
    await mkdir(target, { recursive: true });
    await rename(source, path.join(target, entry.name));
    count += 1;
  }
  return count;
}

async function purgeOldTrash(root, cutoff, currentDay) {
  let count = 0;
  for (const entry of await safeReadDir(root)) {
    if (!entry.isDirectory() || !/^\d{8}$/.test(entry.name) || entry.name === currentDay || dateTimestamp(entry.name) >= cutoff) continue;
    await rm(path.join(root, entry.name), { recursive: true, force: true });
    count += 1;
  }
  return count;
}

async function safeReadDir(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function timestamp(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateTimestamp(value) {
  return Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
}

function dateKey(value) {
  return value.toISOString().slice(0, 10).replaceAll("-", "");
}
