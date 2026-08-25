export const MAX_INITIAL_ATTACHMENT_FILES = 8;
export const MAX_INITIAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set(["pdf", "pptx", "docx", "txt", "md", "markdown"]);

export function selectAttachmentFiles({ existing = [], incoming = [], allowMultiple = true, paperAnalysis = false } = {}) {
  const selected = uniqueFiles(allowMultiple && !paperAnalysis ? [...existing, ...incoming] : incoming.slice(0, 1));
  if (!selected.length) return { ok: false, code: "empty", files: [] };
  if (selected.length > MAX_INITIAL_ATTACHMENT_FILES) {
    return { ok: false, code: "too_many", files: existing };
  }
  const invalid = selected.find((file) => !ALLOWED_EXTENSIONS.has(extensionOf(file.name)));
  if (invalid) return { ok: false, code: "file_type", filename: invalid.name, files: existing };
  if (paperAnalysis && extensionOf(selected[0].name) !== "pdf") {
    return { ok: false, code: "paper_pdf", filename: selected[0].name, files: existing };
  }
  if (selected.some((file) => Number(file.size || 0) > MAX_INITIAL_ATTACHMENT_BYTES)) {
    return { ok: false, code: "file_size", files: existing };
  }
  if (selected.reduce((total, file) => total + Number(file.size || 0), 0) > MAX_INITIAL_ATTACHMENT_BYTES) {
    return { ok: false, code: "total_size", files: existing };
  }
  if ((incoming.length > 1 || existing.length > 1) && (!allowMultiple || paperAnalysis)) {
    return { ok: true, code: "single_only", files: selected.slice(0, 1) };
  }
  return { ok: true, code: "selected", files: selected };
}

export function totalAttachmentBytes(files = []) {
  return files.reduce((total, file) => total + Number(file?.size || 0), 0);
}

function uniqueFiles(files) {
  const seen = new Set();
  return files.filter((file) => {
    if (!file?.name) return false;
    const key = `${file.name}\u0000${file.size || 0}\u0000${file.lastModified || 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extensionOf(filename) {
  return String(filename || "").split(".").pop().toLowerCase();
}
