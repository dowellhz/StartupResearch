import { escapeHtml } from "./markdown-renderer.js";
import { progressStageCopy } from "./progress-stage-copy.js";
import { t } from "./i18n.js";
import { taskTypeLabels } from "./task-type-labels.js";

export function updateReviewStages(stages = [], update = {}) {
  const values = Array.isArray(stages) ? stages : [];
  if (!update?.key) return values;
  const found = values.some((stage) => stage.key === update.key);
  return found
    ? values.map((stage) => stage.key === update.key ? { ...stage, ...update } : stage)
    : [...values, update];
}

export function renderReviewProgressPanel({ container, stages = [], taskType, reportAvailable = false, scrollBottom = () => {} }) {
  let panel = container.querySelector?.("#progressMessage");
  if (!panel) {
    container.insertAdjacentHTML("beforeend", `
      <article class="message assistant" id="progressMessage">
        <div class="message-meta"><span class="avatar">VL</span>${t("progress.agent", { zh: "研究代理" })}</div>
        <div class="assistant-card"><div class="progress-panel"><div class="progress-header"><div><strong></strong><small class="progress-count"></small></div><span class="progress-badge"></span></div><div class="stage-list"></div></div></div>
      </article>`);
    panel = container.querySelector("#progressMessage");
  }
  const values = Array.isArray(stages) ? stages : [];
  panel.querySelector(".stage-list").innerHTML = values.map((stage) => {
    const copy = progressStageCopy(stage);
    return `<div class="stage ${escapeHtml(stage.status)}" data-stage-key="${escapeHtml(stage.key)}">
      <span class="stage-icon">${["completed", "restored"].includes(stage.status) ? "✓" : stage.status === "failed" ? "!" : ""}</span>
      <div><strong>${escapeHtml(copy.label)}</strong><p>${escapeHtml(copy.message)}</p></div>
      <span class="stage-time">${copy.time}</span>
    </div>`;
  }).join("");
  const completed = values.filter((stage) => ["completed", "restored"].includes(stage.status)).length;
  const taskLabel = taskTypeLabels(taskType).task;
  panel.querySelector(".progress-header strong").textContent = reportAvailable
    ? t("progress.taskDone", { zh: `${taskLabel}已完成`, task: taskLabel })
    : t("progress.taskRunning", { zh: `${taskLabel}进行中`, task: taskLabel });
  panel.querySelector(".progress-count").textContent = `${completed}/${values.length}`;
  panel.querySelector(".progress-badge").textContent = reportAvailable ? "DONE" : "LIVE";
  scrollBottom();
  return panel;
}
