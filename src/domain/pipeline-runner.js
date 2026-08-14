import { Result } from "./result.js";

export function createPipelineRunner({
  steps,
  repository,
  prepareContext = (job, runtime) => ({ job, ...runtime }),
  getCheckpoint = (context, step) => context.job.checkpoints?.[step.key],
  restoreContext = (context, step, checkpoint) => ({ ...context, ...(checkpoint.artifact || {}) }),
  beforeStep = async (context) => ({ ...context, job: await repository.save(context.job) }),
  saveCheckpoint,
  emitStage,
  runningMessage = () => "正在执行…",
  completedMessage = () => "已完成",
  stageData = () => ({}),
  onFailure = async (context) => context,
  onComplete = async () => {},
  failureMessage = (error) => error?.expose === true ? error.message : "该阶段暂时失败，已有结果已保留，可稍后重试",
  abortMessage = "任务已终止"
} = {}) {
  if (!Array.isArray(steps) || typeof saveCheckpoint !== "function") throw new Error("pipeline runner 配置不完整");
  const stageEmitter = emitStage || defaultEmitStage;

  async function execute(job, { onEvent = () => {}, signal } = {}) {
    let context = await prepareContext(job, { onEvent, signal });
    for (const [index, step] of steps.entries()) {
      if (signal?.aborted) return Result.fail(abortMessage, { failedStep: step.key, context });
      const checkpoint = getCheckpoint(context, step);
      if (checkpoint?.completed) {
        context = await restoreContext(context, step, checkpoint);
        stageEmitter(context, step, index, "restored", "已从 checkpoint 恢复");
        continue;
      }
      stageEmitter(context, step, index, "running", runningMessage(step.key, context));
      try {
        context = await beforeStep(context, step) || context;
        context = await step.run(context);
        stageEmitter(context, step, index, "completed", completedMessage(step.key, context), stageData(step.key, context));
        context = await saveCheckpoint(context, step) || context;
      } catch (error) {
        context = await onFailure(context, error, step) || context;
        const message = signal?.aborted ? abortMessage : failureMessage(error, context, step);
        stageEmitter(context, step, index, "failed", message);
        await repository.save(context.job).catch(() => {});
        return Result.fail(error, { failedStep: step.key, context, cause: error });
      }
    }
    await onComplete(context);
    return Result.ok(context);
  }

  function defaultEmitStage(context, step, index, status, message, extra = {}) {
    if (Array.isArray(context.job?.stages)) {
      context.job = {
        ...context.job,
        stages: context.job.stages.map((stage) => stage.key === step.key
          ? { ...stage, status, message, updatedAt: new Date().toISOString() }
          : stage)
      };
    }
    context.onEvent?.({ type: "stage", data: { key: step.key, label: step.label, index, total: steps.length, status, message, ...extra }, at: new Date().toISOString() });
  }

  return { execute };
}
