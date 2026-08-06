export function focusResearchStart({ conversation, progressPanel, schedule = globalThis.requestAnimationFrame, onFocused = () => {} } = {}) {
  if (!conversation || !progressPanel) return false;
  const run = typeof schedule === "function" ? schedule : (callback) => callback();
  run(() => {
    const conversationTop = conversation.getBoundingClientRect?.().top || 0;
    const panelTop = progressPanel.getBoundingClientRect?.().top || 0;
    const top = Math.max(0, Number(conversation.scrollTop || 0) + panelTop - conversationTop - 24);
    conversation.scrollTo?.({ top, behavior: "auto" });
    progressPanel.setAttribute?.("tabindex", "-1");
    progressPanel.focus?.({ preventScroll: true });
    onFocused();
  });
  return true;
}
