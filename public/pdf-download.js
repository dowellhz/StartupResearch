export function downloadReviewPdf(id, location = window.location) {
  return navigateToPdf(id, "pdf", location);
}

export function downloadConversationPdf(id, location = window.location) {
  return navigateToPdf(id, "conversation-pdf", location);
}

export function syncConversationPdfButton(button, currentId) {
  button.disabled = !currentId;
  button.setAttribute("aria-disabled", String(!currentId));
}

function navigateToPdf(id, endpoint, location) {
  if (!id) return false;
  location.assign(`/api/reviews/${encodeURIComponent(id)}/${endpoint}`);
  return true;
}
