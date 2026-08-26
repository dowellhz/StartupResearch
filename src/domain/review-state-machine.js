const TRANSITIONS = {
  queued: new Set(["running", "failed", "cancelled"]),
  running: new Set(["completed", "needs_attention", "failed", "cancelled"]),
  completed: new Set(["running"]),
  needs_attention: new Set(["running"]),
  failed: new Set(["running"]),
  cancelled: new Set(["running"])
};

export function transitionReview(job, nextStatus) {
  const allowed = TRANSITIONS[job.status];
  if (!allowed?.has(nextStatus)) {
    throw new Error(`非法任务状态迁移：${job.status} -> ${nextStatus}`);
  }
  return { ...job, status: nextStatus, updatedAt: new Date().toISOString() };
}
