import { createFollowupProgressCard } from "./followup-progress.js";
import { localizeApiError } from "./api-error-messages.js";
import { t } from "./i18n.js";

export async function runFollowup({ question, currentId, messageStream, requestResponse, renderUser, draft, setBusy, scrollBottom, onAccepted = () => {} }) {
  renderUser(question);
  draft.save();
  setBusy(true);
  const card = createFollowupProgressCard(messageStream, { onRender: scrollBottom });
  let answer = "";
  let accepted = false;
  try {
    const response = await requestResponse(`/api/reviews/${currentId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: question })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(localizeApiError({ code: payload.code, message: payload.error || t("followup.failed", { zh: "追问失败" }) }));
    }
    draft.clearPrompt();
    await readEventStream(response, (event) => {
      if (!accepted && ["progress", "status", "delta", "done"].includes(event.type)) { accepted = true; onAccepted(); }
      if (event.type === "progress") card.update(event.data);
      if (event.type === "delta") { answer += event.data.delta || ""; card.append(event.data.delta); }
      if (event.type === "done") { answer = event.data.answer || answer; card.complete(answer); }
      if (event.type === "error") throw new Error(localizeApiError({ code: event.data.code, message: event.data.message }));
    });
  } catch (error) {
    card.fail(error.message);
  } finally {
    setBusy(false);
    scrollBottom();
  }
}

async function readEventStream(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const frames = pending.split("\n\n");
    pending = frames.pop() || "";
    for (const frame of frames) {
      const type = frame.match(/^event:\s*(.+)$/m)?.[1] || "message";
      const data = frame.match(/^data:\s*(.+)$/m)?.[1];
      if (data) onEvent({ type, data: JSON.parse(data) });
    }
  }
}
