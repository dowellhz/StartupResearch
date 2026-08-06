import { escapeHtml } from "./markdown-renderer.js";

export function renderHistoryList({ container, reviews, currentId, requestJson, onOpen, onCurrentDeleted, refresh, notify }) {
  if (!reviews.length) {
    container.innerHTML = '<div class="history-item"><span>暂无历史记录</span></div>';
    return;
  }
  container.innerHTML = reviews.map((review) => `
    <div class="history-row ${review.id === currentId ? "active" : ""}">
      <button class="history-item" data-review-id="${escapeHtml(review.id)}">
        <strong>${escapeHtml(review.companyName || "未命名公司")}</strong>
        <span><i class="history-status ${escapeHtml(review.status)}"></i>${statusLabel(review.status, review.taskType)} · ${relativeDate(review.updatedAt)}</span>
      </button>
      <button class="history-delete" data-delete-id="${escapeHtml(review.id)}" aria-label="删除对话" title="删除对话，保留附件">×</button>
    </div>`).join("");
  container.querySelectorAll("[data-review-id]").forEach((button) => button.addEventListener("click", () => onOpen(button.dataset.reviewId)));
  container.querySelectorAll("[data-delete-id]").forEach((button) => button.addEventListener("click", async () => {
    const id = button.dataset.deleteId;
    if (!window.confirm("删除这条对话？")) return;
    button.disabled = true;
    try {
      await requestJson(`/api/reviews/${id}`, { method: "DELETE" });
      if (id === currentId) onCurrentDeleted();
      const review = reviews.find((item) => item.id === id);
      notify(review?.upload ? "对话已删除，原始附件已保留" : "对话已删除");
      await refresh();
    } catch (error) {
      button.disabled = false;
      notify(error.message);
    }
  }));
}

function relativeDate(value) {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

function statusLabel(status, taskType) {
  if (status === "running") return ({ company_pre_research: "预研中", industry_research: "行业研究中", paper_analysis: "论文解读中" })[taskType] || "核查中";
  return ({ queued: "排队中", completed: "已完成", needs_attention: "需关注", failed: "失败" })[status] || status;
}
