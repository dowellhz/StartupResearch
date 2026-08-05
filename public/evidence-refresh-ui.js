import { escapeHtml, markdownToHtml } from "./markdown-renderer.js";

export function isEvidenceRefreshActive(refresh) {
  return ["queued", "running"].includes(refresh?.status);
}

export function createEvidenceRefreshController({ state, container, requestJson, connectEvents, notify, scrollBottom, refreshHistory, confirmImpl = window.confirm }) {
  function render(review = state.currentReview) {
    return renderEvidenceRefresh(container, { refresh: review?.evidenceRefresh, result: review?.lastEvidenceRefresh });
  }

  async function start() {
    if (!state.currentId || !confirmImpl("将按最多 8 个查询刷新公开资料，并生成独立变化报告。是否继续？")) return;
    try {
      const payload = await requestJson(`/api/reviews/${state.currentId}/refresh`, { method: "POST" });
      state.currentReview = payload.review;
      render(payload.review);
      setButtonDisabled(true);
      connectEvents(state.currentId);
      notify("已开始刷新公开资料");
    } catch (error) {
      notify(error.message);
    }
  }

  function apply(data) {
    state.currentReview = {
      ...state.currentReview,
      evidenceRefresh: data.refresh || state.currentReview?.evidenceRefresh,
      lastEvidenceRefresh: data.result || state.currentReview?.lastEvidenceRefresh
    };
    render();
    scrollBottom();
  }

  function complete(data) {
    apply(data);
    setButtonDisabled(false);
    state.eventSource?.close();
    refreshHistory();
    notify(data.result?.warning ? "资料刷新完成，但有降级提示" : "公开资料变化报告已生成");
  }

  function fail(data) {
    apply(data);
    setButtonDisabled(false);
    state.eventSource?.close();
    notify(data.message || "公开资料刷新失败");
  }

  function setButtonDisabled(disabled) {
    document.querySelector("[data-refresh-evidence]")?.toggleAttribute("disabled", disabled);
  }

  return { apply, complete, fail, render, start };
}

export function renderEvidenceRefresh(container, { refresh, result } = {}) {
  let card = container.querySelector("#evidenceRefreshMessage");
  if (!refresh && !result) {
    card?.remove();
    return null;
  }
  if (!card) {
    card = document.createElement("article");
    card.id = "evidenceRefreshMessage";
    card.className = "message assistant";
    container.append(card);
  }
  card.innerHTML = buildEvidenceRefreshMarkup({ refresh, result });
  container.append(card);
  return card;
}

export function buildEvidenceRefreshMarkup({ refresh, result } = {}) {
  const active = isEvidenceRefreshActive(refresh);
  const steps = Array.isArray(refresh?.steps) ? refresh.steps : [];
  const statusLabel = active ? "LIVE" : result?.status === "needs_attention" || refresh?.status === "failed" ? "ATTENTION" : "DONE";
  const progress = steps.length ? `
    <div class="refresh-stage-list">
      ${steps.map((stage) => `<div class="refresh-stage ${escapeHtml(stage.status || "pending")}"><span></span><div><strong>${escapeHtml(stage.label)}</strong><p>${escapeHtml(stage.message || stageCopy(stage.status))}</p></div></div>`).join("")}
    </div>` : "";
  const report = result?.report ? `<div class="report-content refresh-report">${markdownToHtml(result.report)}</div>` : "";
  return `
    <div class="message-meta"><span class="avatar">VL</span>公开资料刷新</div>
    <div class="report-card evidence-refresh-card">
      <div class="report-toolbar"><div><span>EVIDENCE REFRESH</span><strong>${active ? "正在刷新公开资料" : "公开资料变化报告"}</strong></div><span class="refresh-status ${statusLabel.toLowerCase()}">${statusLabel}</span></div>
      ${progress}
      ${report || (!active ? `<div class="refresh-empty">${escapeHtml(refresh?.error || "本次刷新尚未形成变化报告")}</div>` : "")}
    </div>`;
}

function stageCopy(status) {
  return ({ pending: "等待前序步骤", running: "正在处理", completed: "已完成", restored: "已恢复", failed: "执行失败" })[status] || "";
}
