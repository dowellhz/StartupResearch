export function focusResearchStart({ conversation, progressPanel, schedule = globalThis.requestAnimationFrame } = {}) {
  if (!conversation || !progressPanel) return false;
  const run = typeof schedule === "function" ? schedule : (callback) => callback();
  run(() => {
    progressPanel.setAttribute?.("tabindex", "-1");
    progressPanel.focus?.({ preventScroll: true });
    const conversationTop = conversation.getBoundingClientRect?.().top || 0;
    const panelTop = progressPanel.getBoundingClientRect?.().top || 0;
    const top = Math.max(0, Number(conversation.scrollTop || 0) + panelTop - conversationTop - 24);
    conversation.scrollTo?.({ top, behavior: "smooth" });
  });
  return true;
}
