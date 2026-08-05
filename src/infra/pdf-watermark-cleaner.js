export function removeRepeatedPdfWatermarks(pages = [], { minimumPages = 3, ratio = 0.3 } = {}) {
  const normalizedPages = pages.map((page, index) => ({
    page: Number(page?.page || index + 1),
    lines: String(page?.text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  }));
  const pageFrequency = new Map();
  for (const page of normalizedPages) {
    const fingerprints = new Set(page.lines.map(lineFingerprint).filter(Boolean));
    for (const fingerprint of fingerprints) pageFrequency.set(fingerprint, (pageFrequency.get(fingerprint) || 0) + 1);
  }
  const threshold = Math.max(minimumPages, Math.ceil(normalizedPages.length * ratio));
  const repeated = new Set(Array.from(pageFrequency)
    .filter(([fingerprint, count]) => count >= threshold && isRemovableFingerprint(fingerprint))
    .map(([fingerprint]) => fingerprint));
  const cleanedPages = normalizedPages.map((page) => ({
    page: page.page,
    text: page.lines.filter((line) => !repeated.has(lineFingerprint(line))).join("\n")
  }));
  return {
    pages: cleanedPages,
    removedFingerprints: Array.from(repeated),
    removedLineCount: normalizedPages.reduce((count, page) => (
      count + page.lines.filter((line) => repeated.has(lineFingerprint(line))).length
    ), 0)
  };
}

export function mergePageText(nativeText, ocrText) {
  const nativeLines = usefulLines(nativeText);
  const fingerprints = new Set(nativeLines.map(lineFingerprint));
  const additions = usefulLines(ocrText).filter((line) => {
    const fingerprint = lineFingerprint(line);
    if (!fingerprint || fingerprints.has(fingerprint)) return false;
    fingerprints.add(fingerprint);
    return true;
  });
  return [...nativeLines, ...(additions.length ? ["[OCR 补充]", ...additions] : [])].join("\n");
}

export function meaningfulCharacterCount(value) {
  return String(value || "").replace(/[\s\p{P}\p{S}]/gu, "").length;
}

function usefulLines(value) {
  return String(value || "").normalize("NFKC").split(/\r?\n/)
    .map((line) => line.replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "").trim())
    .filter(Boolean);
}

function lineFingerprint(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "").slice(0, 180);
}

function isRemovableFingerprint(value) {
  return value.length >= 2 && value.length <= 180;
}
