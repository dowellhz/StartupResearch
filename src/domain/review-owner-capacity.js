import { operationalError } from "../infra/public-error.js";

const ACTIVE_STATUSES = new Set(["queued", "running"]);

// 任务准入：owner 活动额度 + 一个排队位，两者都拿到才允许把任务落盘。
//
// 额度部分：「先数一遍再决定放不放行」是个 check-then-act，而任务在 repository.save()
// 内部就已经进入索引、随后才 await 落盘，所以用计数器做占位一定有窗口——新任务已计入
// active，它的创建者却还攥着占位，同一个任务被算两次。这里改成按 owner 串行准入，
// 计数和落盘处于同一临界区，判断天然原子，也就不再需要占位计数。
//
// 队列位部分：排队上限若等到入队时才判定，被拒的任务已经保存，会变成不执行、
// 不通知、还持续占额度的僵尸任务。所以必须在落盘之前预占。
export function createOwnerCapacityGuard({ repository, taskQueue = null, maxActivePerOwner = 3 } = {}) {
  const locks = new Map();

  async function summaries(ownerId, limit) {
    if (typeof repository.listSummaries === "function") return await repository.listSummaries({ ownerId, limit }) || [];
    return await repository.list?.({ ownerId, limit }) || [];
  }

  async function hydrate(summary) {
    return (typeof repository.get === "function" && await repository.get(summary.id)) || summary;
  }

  // 返回的 release 必须在任务状态落盘后立即调用；调用方的 finally 兜底，重复调用无副作用。
  async function reserve(ownerId) {
    const release = await acquire(ownerId);
    try {
      const jobs = await summaries(ownerId, 10000);
      const active = jobs.filter((job) => ACTIVE_STATUSES.has(job.status) || ACTIVE_STATUSES.has(job.evidenceRefresh?.status)).length;
      if (active >= maxActivePerOwner) {
        throw operationalError(`同时运行的研究任务不能超过 ${maxActivePerOwner} 个`, { statusCode: 429, code: "active_task_limit" });
      }
      return release;
    } catch (error) {
      release();
      throw error;
    }
  }

  // 同时拿下额度与队列位；任一失败都完整回滚，调用方拿到的一定是可用的准入。
  async function admit(ownerId) {
    const release = await reserve(ownerId);
    let slot = null;
    try {
      slot = taskQueue?.reserve?.() || null;
    } catch (error) {
      release();
      throw error;
    }
    // release 只归还 owner 锁。队列位必须一直持有到 useSlot() 把它交给入队方，
    // 由入队方在压入队列的同一个同步块里归还——中间一旦出现空档，
    // 其他请求就能抢走这个位置，双方再各自以 admitted 入队，导致超卖。
    return {
      release,
      useSlot: () => { const handed = slot; slot = null; return handed; },
      returnSlot: () => { slot?.(); slot = null; }
    };
  }

  async function withAdmission(ownerId, operation) {
    const admission = await admit(ownerId);
    try {
      return await operation({ release: admission.release, useSlot: admission.useSlot });
    } finally {
      admission.returnSlot();
      admission.release();
    }
  }

  function acquire(ownerId) {
    const previous = locks.get(ownerId) || Promise.resolve();
    let signalDone;
    const held = new Promise((resolve) => { signalDone = resolve; });
    const chain = previous.then(() => held);
    locks.set(ownerId, chain);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      signalDone();
      // 没有后续排队者时清掉，避免 owner 表随访客数无限增长。
      if (locks.get(ownerId) === chain) locks.delete(ownerId);
    };
    return previous.then(() => release);
  }

  return { admit, hydrate, summaries, withAdmission };
}
