const TRANSITIONS = {
  queued: new Set(["running"]),
  running: new Set(["completed", "needs_attention", "failed"]),
  needs_attention: new Set([]),
  completed: new Set([]),
  failed: new Set([])
};

export function transitionEvidenceRefresh(refresh, nextStatus, patch = {}) {
  if (refresh?.status === nextStatus) return { ...refresh, ...patch };
  if (!TRANSITIONS[refresh?.status]?.has(nextStatus)) {
    throw new Error(`非法资料刷新状态迁移：${refresh?.status || "missing"} -> ${nextStatus}`);
  }
  return { ...refresh, ...patch, status: nextStatus };
}
