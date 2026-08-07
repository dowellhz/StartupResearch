export async function recoverActiveReviews({ jobs = [], manager, staleAfterMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  if (!manager?.run || !manager?.failInterrupted) throw new Error("启动恢复服务依赖不完整");
  const resumed = [];
  const failed = [];
  const refreshes = [];
  const currentTime = Number(new Date(now()).getTime());
  for (const job of jobs) {
    if (["queued", "running"].includes(job?.status)) {
      if (isStale(job, currentTime, staleAfterMs)) {
        await manager.failInterrupted(job.id, `任务在服务重启前超过 ${Math.ceil(staleAfterMs / 60000)} 分钟没有保存进度，已停止自动恢复；原文件与阶段结果已保留，可手动重试`);
        failed.push(job.id);
      } else {
        manager.run(job.id).catch(() => {});
        resumed.push(job.id);
      }
    }
    if (["queued", "running"].includes(job?.evidenceRefresh?.status)) {
      manager.runEvidenceRefresh?.(job.id).catch(() => {});
      refreshes.push(job.id);
    }
  }
  return { resumed, failed, refreshes };
}

function isStale(job, currentTime, staleAfterMs) {
  const stages = Array.isArray(job?.stages) ? job.stages : [];
  const activeStage = stages.find((stage) => stage.status === "running");
  const lastActivity = activeStage?.updatedAt || job?.updatedAt || job?.createdAt;
  const timestamp = new Date(lastActivity || 0).getTime();
  return Number.isFinite(timestamp) && currentTime - timestamp > Math.max(60000, Number(staleAfterMs) || 0);
}
