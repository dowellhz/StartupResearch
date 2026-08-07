export function createBoundedTaskQueue({ concurrency = 1 } = {}) {
  const limit = Math.max(1, Math.floor(Number(concurrency) || 1));
  const pending = [];
  let active = 0;

  function run(task) {
    if (typeof task !== "function") return Promise.reject(new Error("队列任务必须是函数"));
    return new Promise((resolve, reject) => {
      pending.push({ task, resolve, reject });
      drain();
    });
  }

  function drain() {
    while (active < limit && pending.length) {
      const item = pending.shift();
      active += 1;
      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  }

  return { run, snapshot: () => ({ active, pending: pending.length, concurrency: limit }) };
}
