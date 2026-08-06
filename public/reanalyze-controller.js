export function createReanalyzeController({ state, requestJson, renderProgress, connectEvents, notify, labelFor, confirmImpl = globalThis.confirm, disableButton = () => {} } = {}) {
  return async function reanalyzeCurrentReview() {
    const taskType = state.currentReview?.taskType || "attachment_review";
    const message = confirmationMessage(taskType);
    if (!state.currentId || !confirmImpl(message)) return;
    try {
      const payload = await requestJson(`/api/reviews/${state.currentId}/reanalyze`, { method: "POST" });
      state.currentReview = payload.review;
      state.stages = payload.review.stages || [];
      state.report = "";
      disableButton();
      renderProgress();
      connectEvents(state.currentId);
      notify(`${labelFor(taskType).rerun}已开始，旧报告已归档`);
    } catch (error) {
      notify(error.message);
    }
  };
}

export function confirmationMessage(taskType) {
  return ({
    company_pre_research: "将重新抓取公开信息并生成公司预研报告。旧报告会先归档，是否继续？",
    industry_research: "将重新规划、检索并生成行业研究报告。旧报告会先归档，是否继续？",
    paper_analysis: "将重新解析论文并补充学术检索。旧报告会先归档，是否继续？"
  })[taskType] || "将使用已保存的原始 BP 重新解析并核查。旧报告会先归档，是否继续？";
}
