import { escapeHtml } from "./markdown-renderer.js";
import { renderStreamingMarkdown, STREAM_RENDER_INTERVAL } from "./streaming-markdown.js";
import { t } from "./i18n.js";
import { progressStageCopy } from "./progress-stage-copy.js";

const INITIAL_STAGES = Object.freeze([
  Object.freeze({ key: "research-plan", label: "判断检索需求", status: "pending", message: "等待分析现有报告" }),
  Object.freeze({ key: "agentic-search", label: "Agentic Search", status: "pending", message: "等待检索判断" }),
  Object.freeze({ key: "answer-generation", label: "生成回答", status: "pending", message: "等待研究资料" })
]);

export function updateFollowupStages(stages, progress) {
  return stages.map((stage) => stage.key === progress.key ? { ...stage, ...progress } : stage);
}

export function renderStreamingFollowupMarkdown(value) {
  return renderStreamingMarkdown(value);
}

export function createFollowupProgressCard(messageStream, { onRender = () => {} } = {}) {
  const article = document.createElement("article");
  article.className = "message assistant followup-research";
  article.innerHTML = `
    <div class="message-meta"><span class="avatar">VL</span>${t("progress.agent", { zh: "研究代理" })}</div>
    <div class="assistant-card"><div class="progress-panel">
      <div class="progress-header"><strong>${t("followup.running", { zh: "追问分析进行中" })}</strong><span class="progress-badge">LIVE</span></div>
      <div class="stage-list"></div>
      <div class="followup-answer hidden"><div class="followup-answer-label">${t("followup.answer", { zh: "研究回答" })}</div><div class="report-content streaming-plain stream-cursor"></div></div>
    </div></div>`;
  messageStream.append(article);
  let stages = INITIAL_STAGES.map((stage) => ({ ...stage }));
  let answer = "";
  let renderTimer = null;
  const list = article.querySelector(".stage-list");
  const answerWrap = article.querySelector(".followup-answer");
  const answerBody = article.querySelector(".report-content");
  const header = article.querySelector(".progress-header strong");
  const badge = article.querySelector(".progress-badge");

  function renderStages() {
    list.innerHTML = stages.map((stage) => { const copy = progressStageCopy(stage); return `
      <div class="stage ${escapeHtml(stage.status)}">
        <span class="stage-icon">${["completed", "restored"].includes(stage.status) ? "✓" : stage.status === "failed" ? "!" : ""}</span>
        <div><strong>${escapeHtml(copy.label)}</strong><p>${escapeHtml(copy.message)}</p></div>
        <span class="stage-time">${copy.time}</span>
      </div>`; }).join("");
    onRender();
  }

  function renderAnswer() {
    renderTimer = null;
    answerBody.innerHTML = renderStreamingFollowupMarkdown(answer);
    answerBody.classList.remove("streaming-plain");
    onRender();
  }

  renderStages();
  return {
    update(progress) { stages = updateFollowupStages(stages, progress); renderStages(); },
    append(delta) {
      answer += delta || "";
      answerWrap.classList.remove("hidden");
      if (!renderTimer) renderTimer = setTimeout(renderAnswer, STREAM_RENDER_INTERVAL);
    },
    complete(finalAnswer) {
      answer = finalAnswer || answer;
      clearTimeout(renderTimer);
      renderTimer = null;
      answerWrap.classList.remove("hidden");
      answerBody.innerHTML = renderStreamingFollowupMarkdown(answer);
      answerBody.classList.remove("streaming-plain", "stream-cursor");
      header.textContent = t("followup.completed", { zh: "追问分析已完成" });
      badge.textContent = "DONE";
      onRender();
    },
    fail(message) {
      clearTimeout(renderTimer);
      renderTimer = null;
      answerWrap.classList.remove("hidden");
      answerBody.innerHTML = answer
        ? `${renderStreamingFollowupMarkdown(answer)}<blockquote>${escapeHtml(t("followup.draftSaved", { zh: "上次回答未完成，已保存为草稿，可重新提问。" }))}</blockquote>`
        : escapeHtml(t("followup.failed", { zh: `回答失败：${message}`, message }));
      answerBody.classList.remove("streaming-plain", "stream-cursor");
      header.textContent = t("followup.incomplete", { zh: "追问分析未完成" });
      badge.textContent = "ERROR";
      onRender();
    }
  };
}
