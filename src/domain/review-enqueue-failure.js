import { transitionReview } from "./review-state-machine.js";
import { publicRefresh } from "./evidence-refresh-service.js";

// 任务此时已经落盘。入队失败若只记日志，它会永远停在 queued：不执行、不通知用户，
// 还持续占用该用户的活动额度。这里把它落到终态并广播，用户能看到原因，
// 也能用现有的重试入口重新发起。
export function createEnqueueFailureHandler({ repository, publish, logger = {}, now = () => new Date().toISOString() } = {}) {
  async function failReview(id, ownerId, error, { started = false } = {}) {
    await logger.error?.(started ? "review.execution_failed" : "review.enqueue_failed", { jobId: id, ownerId, error });
    try {
      const job = await repository.get(id);
      if (!job || !["queued", "running"].includes(job.status)) return;
      const message = readableReason(error, started ? "任务启动失败，请稍后重试" : "任务未能进入研究队列，请稍后重试");
      const failed = transitionReview(job, "failed");
      const failedStep = job.failedStep || (started ? "task-execution" : "queue-admission");
      const saved = await repository.save({ ...failed, error: message, failedStep });
      publish(id, { type: "error", data: { message, code: error?.code || "", failedStep: saved.failedStep, status: saved.status }, at: now() });
    } catch (failure) {
      await logger.error?.("review.enqueue_fail_unhandled", { jobId: id, error: failure });
    }
  }

  async function failRefresh(id, ownerId, error, { started = false } = {}) {
    await logger.error?.(started ? "review.refresh_execution_failed" : "review.refresh_failed", { jobId: id, ownerId, error });
    try {
      const job = await repository.get(id);
      if (!["queued", "running"].includes(job?.evidenceRefresh?.status)) return;
      const message = readableReason(error, started ? "公开资料刷新启动失败，请稍后重试" : "公开资料刷新未能进入队列，请稍后重试");
      const failedStep = started ? "refresh-execution" : "queue-admission";
      const evidenceRefresh = { ...job.evidenceRefresh, status: "failed", error: message, failedStep, completedAt: now() };
      await repository.save({ ...job, evidenceRefresh });
      publish(id, { type: "refresh_error", data: { message, code: error?.code || "", failedStep, refresh: publicRefresh(evidenceRefresh) }, at: now() });
    } catch (failure) {
      await logger.error?.("review.refresh_fail_unhandled", { jobId: id, error: failure });
    }
  }

  return { failReview, failRefresh };
}

// 只有明确标记可暴露的运营错误才把原文交给用户，避免泄漏内部细节。
function readableReason(error, fallback) {
  return error?.expose === true && error?.message ? error.message : fallback;
}
