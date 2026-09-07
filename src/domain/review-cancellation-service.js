import { transitionReview } from "./review-state-machine.js";
import { operationalError } from "../infra/public-error.js";
import { array, publicJob } from "./review-manager-support.js";

const ACTIVE_STATUSES = new Set(["queued", "running"]);

export function createReviewCancellationService({ repository, controllers, requireOwnedJob, publish, logger = {}, now = () => new Date().toISOString() }) {
  const stoppingIds = new Set();
  const settleWaiters = new Map();

  async function cancel(id, { ownerId } = {}) {
    const job = await requireOwnedJob(id, ownerId);
    if (!ACTIVE_STATUSES.has(job.status)) {
      throw operationalError("只有排队中或进行中的研究可以停止", { statusCode: 409, code: "cancel_not_allowed" });
    }
    if (controllers.has(id)) stoppingIds.add(id);
    const saved = await repository.save(stoppedJob(job, now()));
    controllers.get(id)?.abort(new Error("用户已停止研究"));
    publish(id, { type: "snapshot", data: publicJob(saved), at: now() });
    await logger.audit?.("review.cancelled", { jobId: id, ownerId });
    return publicJob(saved);
  }

  function assertSettled(id) {
    if (controllers.has(id) || stoppingIds.has(id)) {
      throw operationalError("研究正在停止，请稍后再重试", { statusCode: 409, code: "cancel_in_progress" });
    }
  }

  function isStopping(id) {
    return stoppingIds.has(id);
  }

  function waitForSettled(id) {
    if (!stoppingIds.has(id)) return Promise.resolve();
    return new Promise((resolve) => {
      const waiters = settleWaiters.get(id) || new Set();
      waiters.add(resolve);
      settleWaiters.set(id, waiters);
    });
  }

  async function settle(id) {
    if (!stoppingIds.delete(id)) return false;
    try {
      const latest = await repository.get(id);
      if (!latest) return false;
      const saved = await repository.save(stoppedJob(latest, now()));
      publish(id, { type: "snapshot", data: publicJob(saved), at: now() });
      return true;
    } finally {
      for (const resolve of settleWaiters.get(id) || []) resolve();
      settleWaiters.delete(id);
    }
  }

  return { assertSettled, cancel, isStopping, settle, waitForSettled };
}

export function stoppedJob(job, stoppedAt) {
  const stopped = ACTIVE_STATUSES.has(job.status) ? transitionReview(job, "cancelled") : { ...job, status: "cancelled", updatedAt: stoppedAt };
  return {
    ...stopped,
    stoppedAt,
    updatedAt: stoppedAt,
    error: "",
    failedStep: "",
    stages: array(job.stages).map((stage) => stage.status === "running"
      ? { ...stage, status: "cancelled", message: "用户已停止研究", updatedAt: stoppedAt }
      : stage)
  };
}

export function resumedJob(job) {
  return {
    ...job,
    stoppedAt: "",
    stages: array(job.stages).map((stage) => stage.status === "cancelled"
      ? { ...stage, status: "pending", message: "" }
      : stage)
  };
}
