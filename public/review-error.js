export function applyRecoverableReport(data, { state, renderReportContent, renderProgressPanel }) {
  if (!data?.report) return false;
  state.report = data.report;
  state.currentReview = {
    ...state.currentReview,
    reportAvailable: true,
    status: data.status || "needs_attention",
    quality: data.quality
  };
  renderReportContent(data.report, false, data.quality);
  renderProgressPanel();
  return true;
}
