import { operationalError } from "./public-error.js";

export function createBoundedTaskQueue({ concurrency = 1, maxPending = 0 } = {}) {
  const limit = Math.max(1, Math.floor(Number(concurrency) || 1));
  const queueLimit = Math.max(0, Math.floor(Number(maxPending) || 0));
  const pending = [];
  const activeByKey = new Map();
  const lastDispatch = new Map();
  let active = 0;
  let tick = 0;
  let reservations = 0;

  // 排队深度上限是准入控制，必须在调用方落盘之前就能判定，否则会留下
  // 已保存却永远不会执行的任务。reserve() 先占一个位并返回归还函数；
  // 真正入队时带 admitted:true，此时不再二次判定，入队不可能失败。
  function reserve() {
    const full = queueFull();
    if (full) throw full;
    reservations += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      reservations = Math.max(0, reservations - 1);
    };
  }

  function run(task, { key = "", admitted = false } = {}) {
    if (typeof task !== "function") return Promise.reject(new Error("队列任务必须是函数"));
    if (!admitted) {
      const full = queueFull();
      if (full) return Promise.reject(full);
    }
    return new Promise((resolve, reject) => {
      pending.push({ task, resolve, reject, key: String(key || "") });
      drain();
    });
  }

  function queueFull() {
    if (!queueLimit || pending.length + reservations < queueLimit) return null;
    return operationalError("研究队列已满，请稍后再提交", { statusCode: 429, code: "task_queue_full" });
  }

  // 公平调度：单个用户连续提交时不能占满全部执行槽让其他用户饿死。
  // 排序依据依次为「该 key 正在执行的任务数」「该 key 上次派发的次序」「入队顺序」，
  // 因此同一 key 内部仍是先进先出，未标记 key 的任务（例如 PDF 解析）保持纯 FIFO。
  function takeNext() {
    let chosen = 0;
    let best = null;
    for (const [index, item] of pending.entries()) {
      const score = [activeByKey.get(item.key) || 0, item.key ? lastDispatch.get(item.key) || 0 : 0, index];
      if (!best || isLower(score, best)) {
        best = score;
        chosen = index;
      }
    }
    return pending.splice(chosen, 1)[0];
  }

  function drain() {
    while (active < limit && pending.length) {
      const item = takeNext();
      active += 1;
      tick += 1;
      if (item.key) {
        activeByKey.set(item.key, (activeByKey.get(item.key) || 0) + 1);
        lastDispatch.set(item.key, tick);
      }
      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          active -= 1;
          releaseKey(item.key);
          drain();
        });
    }
  }

  function releaseKey(key) {
    if (key) {
      const remaining = (activeByKey.get(key) || 1) - 1;
      if (remaining > 0) activeByKey.set(key, remaining);
      else activeByKey.delete(key);
    }
    // 队列彻底空闲时丢弃轮转状态，避免 key 表随访客数无限增长。
    if (!pending.length && !active) lastDispatch.clear();
  }

  return {
    reserve,
    run,
    snapshot: () => ({ active, pending: pending.length, reserved: reservations, concurrency: limit, maxPending: queueLimit })
  };
}

function isLower(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return false;
}
