export function applyDetectedCompany(stage, { state, elements, saveDraft, refreshHistory }) {
  if (!stage.companyName) return;
  state.currentReview = { ...state.currentReview, companyName: stage.companyName, title: stage.title };
  elements.companyInput.value = stage.companyName;
  elements.conversationTitle.textContent = stage.title;
  document.querySelectorAll(".request-company").forEach((item) => { item.textContent = stage.companyName; });
  saveDraft();
  refreshHistory();
}
