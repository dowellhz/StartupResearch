import { escapeHtml, markdownToHtml } from "./markdown-renderer.js";
import { t } from "./i18n.js";
import { progressStageCopy } from "./progress-stage-copy.js";

export function isEvidenceRefreshActive(refresh) {
  return ["queued", "running"].includes(refresh?.status);
}

export function createEvidenceRefreshController({ state, container, requestJson, connectEvents, closeEvents = () => {}, notify, scrollBottom, refreshHistory, confirmImpl = window.confirm }) {
  function render(review = state.currentReview) {
    return renderEvidenceRefresh(container, { refresh: review?.evidenceRefresh, result: review?.lastEvidenceRefresh });
  }

  async function start() {
    if (!state.currentId || !confirmImpl(t("refresh.confirm", { zh: "将按最多 8 个查询刷新公开资料，并生成独立变化报告。是否继续？" }))) return;
    try {
      const payload = await requestJson(`/api/reviews/${state.currentId}/refresh`, { method: "POST" });
      state.currentReview = payload.review;
      render(payload.review);
      setButtonDisabled(true);
      connectEvents(state.currentId);
      notify(t("refresh.started", { zh: "已开始刷新公开资料" }));
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
    closeEvents();
    refreshHistory();
    notify(data.result?.warning ? t("refresh.degraded", { zh: "资料刷新完成，但有降级提示" }) : t("refresh.completed", { zh: "公开资料变化报告已生成" }));
  }

  function fail(data) {
    apply(data);
    setButtonDisabled(false);
    closeEvents();
    notify(data.message || t("refresh.failed", { zh: "公开资料刷新失败" }));
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
    card.innerHTML = buildEvidenceRefreshMarkup({ refresh, result });
    card.querySelector("[data-refresh-report]").sourceMarkdown = String(result?.report || "");
    container.append(card);
    return card;
  }
  patchEvidenceRefreshCard(card, { refresh, result });
  return card;
}

export function buildEvidenceRefreshMarkup({ refresh, result } = {}) {
  const view = evidenceRefreshView(refresh, result);
  return `
    <div class="message-meta"><span class="avatar">VL</span><span data-refresh-label>${t("refresh.label", { zh: "公开资料刷新" })}</span></div>
    <div class="report-card evidence-refresh-card">
      <div class="report-toolbar"><div><span>EVIDENCE REFRESH</span><strong data-refresh-title>${view.title}</strong></div><span class="refresh-status ${view.statusLabel.toLowerCase()}" data-refresh-status>${view.statusLabel}</span></div>
      <div class="refresh-stage-list${view.steps.length ? "" : " hidden"}" data-refresh-stages>${buildRefreshStagesMarkup(view.steps)}</div>
      <div class="report-content refresh-report${view.report ? "" : " hidden"}" data-refresh-report>${view.report ? markdownToHtml(view.report) : ""}</div>
      <div class="refresh-empty${view.showEmpty ? "" : " hidden"}" data-refresh-empty>${escapeHtml(view.emptyMessage)}</div>
    </div>`;
}

function patchEvidenceRefreshCard(card, { refresh, result }) {
  const view = evidenceRefreshView(refresh, result);
  patchText(card.querySelector("[data-refresh-label]"), t("refresh.label", { zh: "公开资料刷新" }));
  patchText(card.querySelector("[data-refresh-title]"), view.title);
  const status = card.querySelector("[data-refresh-status]");
  patchText(status, view.statusLabel);
  patchClass(status, `refresh-status ${view.statusLabel.toLowerCase()}`);
  patchRefreshStages(card.querySelector("[data-refresh-stages]"), view.steps);

  const report = card.querySelector("[data-refresh-report]");
  report.classList.toggle("hidden", !view.report);
  if (report.sourceMarkdown !== view.report) {
    report.innerHTML = view.report ? markdownToHtml(view.report) : "";
    report.sourceMarkdown = view.report;
  }
  const empty = card.querySelector("[data-refresh-empty]");
  empty.classList.toggle("hidden", !view.showEmpty);
  patchText(empty, view.emptyMessage);
}

function patchRefreshStages(list, steps) {
  list.classList.toggle("hidden", !steps.length);
  const existing = new Map(Array.from(list.children).map((node) => [node.dataset.refreshStageKey, node]));
  const retained = new Set();
  steps.forEach((stage, index) => {
    const key = refreshStageKey(stage, index);
    retained.add(key);
    let node = existing.get(key);
    if (!node) {
      node = list.ownerDocument.createElement("div");
      node.dataset.refreshStageKey = key;
      node.innerHTML = "<span></span><div><strong></strong><p></p></div>";
    }
    const copy = progressStageCopy(stage);
    patchClass(node, `refresh-stage ${refreshStageStatus(stage.status)}`);
    patchText(node.querySelector("strong"), copy.label);
    patchText(node.querySelector("p"), copy.message);
    const current = list.children[index];
    if (current !== node) list.insertBefore(node, current || null);
  });
  for (const [key, node] of existing) if (!retained.has(key)) node.remove();
}

function evidenceRefreshView(refresh, result) {
  const active = isEvidenceRefreshActive(refresh);
  const report = String(result?.report || "");
  const statusLabel = active ? "LIVE" : result?.status === "needs_attention" || refresh?.status === "failed" ? "ATTENTION" : "DONE";
  return {
    active,
    report,
    statusLabel,
    steps: Array.isArray(refresh?.steps) ? refresh.steps : [],
    title: active ? t("refresh.running", { zh: "正在刷新公开资料" }) : t("refresh.report", { zh: "公开资料变化报告" }),
    showEmpty: !active && !report,
    emptyMessage: String(refresh?.error || t("refresh.empty", { zh: "本次刷新尚未形成变化报告" }))
  };
}

function buildRefreshStagesMarkup(steps) {
  return steps.map((stage, index) => {
    const copy = progressStageCopy(stage);
    return `<div class="refresh-stage ${refreshStageStatus(stage.status)}" data-refresh-stage-key="${escapeHtml(refreshStageKey(stage, index))}"><span></span><div><strong>${escapeHtml(copy.label)}</strong><p>${escapeHtml(copy.message)}</p></div></div>`;
  }).join("");
}

function refreshStageKey(stage, index) {
  return String(stage?.key || `refresh-stage-${index}`);
}

function refreshStageStatus(value) {
  return ["pending", "running", "completed", "restored", "failed"].includes(value) ? value : "pending";
}

function patchText(node, value) {
  const next = String(value || "");
  if (node.textContent !== next) node.textContent = next;
}

function patchClass(node, value) {
  if (node.className !== value) node.className = value;
}
