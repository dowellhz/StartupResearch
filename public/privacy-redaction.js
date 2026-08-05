const INVESTOR_NAME = /北极光(?:创投)?/g;
const CONFIDENTIAL_PREFIX = /【[^】]*北极光(?:创投)?[^】]*】/g;

export function redactSensitiveText(value) {
  return String(value || "").replace(INVESTOR_NAME, "投资方");
}

export function sanitizeVisibleFilename(value) {
  const filename = String(value || "")
    .replace(CONFIDENTIAL_PREFIX, "")
    .replace(INVESTOR_NAME, "")
    .replace(/[-_\s]+(?=\.[^.]+$)/, "")
    .replace(/-{2,}/g, "-")
    .trim();
  return filename || "business-plan.pdf";
}
