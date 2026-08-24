export function createWorkspaceView({ conversation, promptInput, toastRegion, isAutoFollow, requestFrame = requestAnimationFrame, setTimer = setTimeout }) {
  function autoResize() {
    promptInput.style.height = "auto";
    promptInput.style.height = `${Math.min(promptInput.scrollHeight, 110)}px`;
  }

  function scrollBottom(force = false) {
    if (!force && !isAutoFollow()) return;
    requestFrame(() => conversation.scrollTo({ top: conversation.scrollHeight, behavior: "auto" }));
  }

  function isNearBottom() {
    return conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 120;
  }

  function toast(message) {
    const item = document.createElement("div");
    item.className = "toast";
    item.textContent = message;
    toastRegion.append(item);
    setTimer(() => item.remove(), 3800);
  }

  return { autoResize, isNearBottom, scrollBottom, toast };
}
