import { transitionReview } from "./review-state-machine.js";
import { array, publicJob } from "./review-manager-support.js";

const ACTIVE_STATUSES = new Set(["queued", "running"]);

export function createReviewCancellationService({ repository, controllers, requireOwnedJob, publish, logger = {}, now = () => new Date().toISOString() }) {
  const stoppingIds = new Set();

  async function cancel(id, { ownerId } = {}) {
    const job = await requireOwnedJob(id, ownerId);
    if (!ACTIVE_STATUSES.has(job.status)) {
      throw Object.assign(new Error("只有排队中或进行中的研究可以停止"), { statusCode: 409 });
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
      throw Object.assign(new Error("研究正在停止，请稍后再重试"), { statusCode: 409 });
    }
  }

  function isStopping(id) {
    return stoppingIds.has(id);
  }

  async function settle(id) {
    if (!stoppingIds.delete(id)) return false;
    const latest = await repository.get(id);
    if (!latest) return false;
    const saved = await repository.save(stoppedJob(latest, now()));
    publish(id, { type: "snapshot", data: publicJob(saved), at: now() });
    return true;
  }

  return { assertSettled, cancel, isStopping, settle };
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
