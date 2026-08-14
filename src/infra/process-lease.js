import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

export async function acquireProcessLease({ dataDir, pid = process.pid, isAlive = defaultIsAlive } = {}) {
  await mkdir(dataDir, { recursive: true });
  const leasePath = path.join(dataDir, ".venture-lens.lock");
  try {
    return await createLease(leasePath, pid);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existingPid = Number(await readFile(leasePath, "utf8").catch(() => "0"));
    if (existingPid > 0 && isAlive(existingPid)) {
      throw new Error(`VentureLens 已由进程 ${existingPid} 运行；当前文件存储模式仅支持单实例`);
    }
    await unlink(leasePath).catch((unlinkError) => {
      if (unlinkError.code !== "ENOENT") throw unlinkError;
    });
    return createLease(leasePath, pid);
  }
}

async function createLease(leasePath, pid) {
  const handle = await open(leasePath, "wx", 0o600);
  await handle.writeFile(String(pid), "utf8");
  await handle.close();
  let released = false;
  return {
    path: leasePath,
    async release() {
      if (released) return;
      released = true;
      const current = String(await readFile(leasePath, "utf8").catch(() => ""));
      if (current === String(pid)) await unlink(leasePath).catch(() => {});
    }
  };
}

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
