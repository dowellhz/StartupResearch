import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { operationalError } from "../infra/public-error.js";

export function createFileUsageBudget({ dataDir, ownerDailyLimit = 100, globalDailyLimit = 1000, now = () => new Date() } = {}) {
  const directory = path.join(dataDir, "usage");
  let chain = Promise.resolve();

  function consume(ownerId, units) {
    const task = chain.then(() => consumeOnce(ownerId, Math.max(1, Number(units) || 1)));
    chain = task.catch(() => {});
    return task;
  }

  function refund(receipt) {
    if (!receipt?.day || !receipt?.ownerId || !(receipt.units > 0)) return Promise.resolve(false);
    const task = chain.then(() => refundOnce(receipt));
    chain = task.catch(() => {});
    return task;
  }

  async function consumeOnce(ownerId, units) {
    const day = isoDay(now());
    const target = path.join(directory, `${day}.json`);
    await mkdir(directory, { recursive: true });
    const value = await readJson(target);
    const ownerUsed = Number(value.owners?.[ownerId] || 0);
    const globalUsed = Number(value.total || 0);
    if (ownerUsed + units > ownerDailyLimit || globalUsed + units > globalDailyLimit) {
      throw operationalError("今日研究额度已用完，请明日再试或联系管理员", {
        statusCode: 429,
        code: "daily_budget_exceeded",
        retryAfterSeconds: secondsUntilTomorrow(now())
      });
    }
    const next = {
      day,
      total: globalUsed + units,
      owners: { ...(value.owners || {}), [ownerId]: ownerUsed + units }
    };
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2), "utf8");
    await rename(temporary, target);
    return { day, ownerId, units, ownerRemaining: ownerDailyLimit - next.owners[ownerId], globalRemaining: globalDailyLimit - next.total };
  }

  async function refundOnce({ day, ownerId, units }) {
    const target = path.join(directory, `${day}.json`);
    const value = await readJson(target);
    const ownerUsed = Math.max(0, Number(value.owners?.[ownerId] || 0) - units);
    const owners = { ...(value.owners || {}), [ownerId]: ownerUsed };
    if (!ownerUsed) delete owners[ownerId];
    const next = { day, total: Math.max(0, Number(value.total || 0) - units), owners };
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2), "utf8");
    await rename(temporary, target);
    return true;
  }

  return { consume, refund };
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return { total: 0, owners: {} };
    throw error;
  }
}

function isoDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function secondsUntilTomorrow(value) {
  const current = new Date(value);
  const tomorrow = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() + 1));
  return Math.max(1, Math.ceil((tomorrow - current) / 1000));
}
