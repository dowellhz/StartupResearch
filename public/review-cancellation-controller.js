import { t } from "./i18n.js";

export function createReviewCancellationController({ state, requestJson, closeEvents, renderProgress, focusResearchStart = () => {}, connectEvents, refreshHistory, notify, confirmImpl = globalThis.confirm } = {}) {
  let requestInFlight = false;

  async function cancel() {
    if (requestInFlight || !state.currentId || !["queued", "running"].includes(state.currentReview?.status)) return;
    if (!confirmImpl(t("cancel.confirm", { zh: "停止当前研究？已完成的阶段会保留，之后可以继续研究。" }))) return;
    await update("cancel", t("cancel.done", { zh: "研究已停止，已完成的阶段已保留" }));
  }

  async function resume() {
    if (requestInFlight || !state.currentId || state.currentReview?.status !== "cancelled") return;
    state.currentReview = { ...state.currentReview, resumePending: true };
    renderProgress();
    await update("retry", t("cancel.resumed", { zh: "已从保留的阶段继续研究" }), true);
  }

  async function update(action, successMessage, reconnect = false) {
    requestInFlight = true;
    try {
      const payload = await requestJson(`/api/reviews/${state.currentId}/${action}`, { method: "POST" });
      state.currentReview = payload.review;
      state.stages = payload.review.stages || state.stages;
      if (reconnect) {
        state.autoFollow = false;
        renderProgress();
        focusResearchStart();
        connectEvents(state.currentId);
      } else {
        closeEvents();
        renderProgress();
      }
      await refreshHistory();
      notify(successMessage);
    } catch (error) {
      if (state.currentReview?.resumePending) {
        state.currentReview = { ...state.currentReview, resumePending: false };
        renderProgress();
      }
      notify(error.message);
    } finally {
      requestInFlight = false;
    }
  }

  return { cancel, resume };
}
