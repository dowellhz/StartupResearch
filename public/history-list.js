import { escapeHtml } from "./markdown-renderer.js";
import { t } from "./i18n.js";

export function renderHistoryList({ container, reviews, currentId, requestJson, onOpen, onCurrentDeleted, refresh, notify }) {
  if (!reviews.length) {
    container.innerHTML = `<div class="history-item"><span>${escapeHtml(t("history.empty", { zh: "暂无历史记录" }))}</span></div>`;
    return;
  }
  container.innerHTML = reviews.map((review) => `
    <div class="history-row ${review.id === currentId ? "active" : ""}">
      <button class="history-item" data-review-id="${escapeHtml(review.id)}">
        <strong>${escapeHtml(review.companyName || t("history.unnamed", { zh: "未命名公司" }))}</strong>
        <span><i class="history-status ${escapeHtml(review.status)}"></i>${statusLabel(review.status, review.taskType)} · ${relativeDate(review.updatedAt)}</span>
      </button>
      <button class="history-delete" data-delete-id="${escapeHtml(review.id)}" aria-label="${escapeHtml(t("history.delete", { zh: "删除对话" }))}" title="${escapeHtml(t("history.deleteTitle", { zh: "删除对话，保留附件" }))}">×</button>
    </div>`).join("");
  container.querySelectorAll("[data-review-id]").forEach((button) => button.addEventListener("click", () => onOpen(button.dataset.reviewId)));
  container.querySelectorAll("[data-delete-id]").forEach((button) => button.addEventListener("click", async () => {
    const id = button.dataset.deleteId;
    if (!window.confirm(t("history.confirmDelete", { zh: "删除这条对话？" }))) return;
    button.disabled = true;
    try {
      await requestJson(`/api/reviews/${id}`, { method: "DELETE" });
      if (id === currentId) onCurrentDeleted();
      const review = reviews.find((item) => item.id === id);
      notify(review?.upload ? t("history.deletedRetained", { zh: "对话已删除，原始附件已保留" }) : t("history.deleted", { zh: "对话已删除" }));
      await refresh();
    } catch (error) {
      button.disabled = false;
      notify(error.message);
    }
  }));
}

function relativeDate(value) {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60000) return t("history.now", { zh: "刚刚" });
  if (diff < 3600000) { const count = Math.floor(diff / 60000); return t("history.minutes", { zh: `${count} 分钟前`, count }); }
  if (diff < 86400000) { const count = Math.floor(diff / 3600000); return t("history.hours", { zh: `${count} 小时前`, count }); }
  const count = Math.floor(diff / 86400000);
  return t("history.days", { zh: `${count} 天前`, count });
}

function statusLabel(status, taskType) {
  if (status === "running") return ({ company_pre_research: t("status.company", { zh: "预研中" }), industry_research: t("status.industry", { zh: "行业研究中" }), paper_analysis: t("status.paper", { zh: "论文解读中" }) })[taskType] || t("status.reviewing", { zh: "核查中" });
  return ({ queued: t("status.queued", { zh: "排队中" }), completed: t("status.completed", { zh: "已完成" }), needs_attention: t("status.attention", { zh: "需关注" }), failed: t("status.failed", { zh: "失败" }) })[status] || status;
}
