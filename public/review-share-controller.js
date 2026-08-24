import { t } from "./i18n.js";

export function createReviewShareController({ button, requestJson, getReview, openReview, refreshHistory, notify, location = globalThis.location, history = globalThis.history, clipboard = globalThis.navigator?.clipboard }) {
  function bind() {
    button.addEventListener("click", shareCurrent);
  }

  function sync(review = getReview()) {
    const visible = Boolean(review?.id);
    button.classList.toggle("hidden", !visible);
    button.disabled = !visible || !review.reportAvailable || ["queued", "running"].includes(review.status) || ["queued", "running"].includes(review.evidenceRefresh?.status);
  }

  async function shareCurrent() {
    const review = getReview();
    if (!review?.id || button.disabled) return;
    button.disabled = true;
    try {
      const payload = await requestJson(`/api/reviews/${review.id}/share`, { method: "POST" });
      const url = new URL(payload.share.path, location.origin).href;
      await copyText(url, clipboard);
      notify(t("share.copied", { zh: "分享链接已复制；接收方打开后会创建独立副本" }));
    } catch (error) {
      notify(error.message);
    } finally {
      sync();
    }
  }

  async function importFromLocation() {
    const shareId = shareIdFromPath(location.pathname);
    if (!shareId) return false;
    try {
      const payload = await requestJson(`/api/shares/${shareId}/import`, { method: "POST" });
      history?.replaceState?.({}, "", "/");
      await refreshHistory();
      await openReview(payload.review.id);
      notify(payload.imported
        ? t("share.imported", { zh: "分享条目已作为独立副本合并到当前会话" })
        : t("share.opened", { zh: "这个分享条目已合并过，已打开现有副本" }));
      return true;
    } catch (error) {
      notify(error.message);
      return false;
    }
  }

  return { bind, importFromLocation, sync };
}

export function shareIdFromPath(pathname) {
  return String(pathname || "").match(/^\/share\/(share_[a-zA-Z0-9_-]{32,100})\/?$/)?.[1] || "";
}

async function copyText(value, clipboard) {
  if (clipboard?.writeText) return clipboard.writeText(value);
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error(t("share.copyFailed", { zh: "无法复制分享链接，请检查浏览器剪贴板权限" }));
}
