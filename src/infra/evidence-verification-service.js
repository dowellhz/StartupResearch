import { createHash } from "node:crypto";

const HIGH_PRIORITIES = new Set(["critical", "high"]);
const TRACEABLE_STATUSES = new Set(["verified", "page_corrected"]);

export function createEvidenceVerificationService({ hashText = sha256 } = {}) {
  function buildManifest({ claims = [], sources = [], coverage = [], document = {}, now = "" } = {}) {
    const sourceById = new Map(array(sources).map((source) => [String(source?.id || ""), source]));
    const coverageByClaim = new Map(array(coverage).map((item) => [String(item?.claimId || ""), item]));
    const entries = array(claims).slice(0, 100).map((claim, index) => {
      const claimId = clean(claim?.id, 100) || `claim_${index + 1}`;
      const assessment = coverageByClaim.get(claimId) || {};
      const sourceIds = unique([
        ...array(assessment.supportedBy),
        ...array(assessment.conflictedBy),
        ...array(assessment.candidates)
      ]);
      return {
        claimId,
        importance: normalizeImportance(claim?.importance),
        documentCitation: verifyDocumentCitation({
          evidence: claim?.bpEvidence,
          document,
          claimId,
          hashText
        }),
        webCitations: sourceIds.map((sourceId) => webCitation(sourceById.get(sourceId), { claimId, hashText })).filter(Boolean)
      };
    });
    const highPriority = entries.filter((item) => HIGH_PRIORITIES.has(item.importance));
    const openHighPriority = highPriority.filter((item) => !TRACEABLE_STATUSES.has(item.documentCitation.verificationStatus));
    const citations = entries.flatMap((item) => [item.documentCitation, ...item.webCitations]);
    return {
      version: 1,
      generatedAt: clean(now, 100),
      claims: entries,
      summary: {
        totalClaims: entries.length,
        highPriorityClaims: highPriority.length,
        traceableDocumentClaims: entries.filter((item) => TRACEABLE_STATUSES.has(item.documentCitation.verificationStatus)).length,
        openHighPriorityDocumentCitations: openHighPriority.length,
        verifiedCitations: citations.filter((item) => TRACEABLE_STATUSES.has(item.verificationStatus)).length,
        capturedWebCitations: citations.filter((item) => item.verificationStatus === "captured").length,
        failedCitations: citations.filter((item) => item.verificationStatus === "failed").length
      },
      quality: {
        ok: openHighPriority.length === 0,
        warning: openHighPriority.length
          ? `${openHighPriority.length} 条高优先级声明缺少可在 BP 原文中复核的逐字引用`
          : ""
      }
    };
  }

  function enrichClaimLedger(claimLedger = {}, manifest = {}) {
    const citationsByClaim = new Map(array(manifest.claims).map((item) => [item.claimId, item]));
    const claims = array(claimLedger.claims).map((claim) => {
      const evidence = citationsByClaim.get(claim.id);
      return evidence ? { ...claim, citationEvidence: evidence } : claim;
    });
    return {
      ...claimLedger,
      claims,
      summary: { ...(claimLedger.summary || {}), evidenceTrust: manifest.summary || {} }
    };
  }

  return { buildManifest, enrichClaimLedger };
}

export function verifyDocumentCitation({ evidence, document = {}, claimId = "", hashText = sha256 } = {}) {
  const parsed = parseDocumentEvidence(evidence);
  const pages = documentPages(document);
  const base = {
    id: `document_${clean(claimId, 100) || "claim"}`,
    sourceKind: "document",
    sourceId: "bp_upload",
    sourcePath: clean(document.filename, 500),
    pageNumber: parsed.pageNumber,
    exactQuote: parsed.exactQuote,
    charStart: null,
    charEnd: null,
    matchMethod: "none",
    verificationStatus: parsed.exactQuote ? "failed" : "unverified",
    evidenceHash: parsed.exactQuote ? hashText(evidenceFingerprint("document", document.filename, parsed.pageNumber, parsed.exactQuote)) : ""
  };
  if (!parsed.exactQuote || !pages.length) return base;
  const preferred = parsed.pageNumber ? pages.filter((page) => page.pageNumber === parsed.pageNumber) : [];
  const remaining = pages.filter((page) => !preferred.includes(page));
  for (const page of [...preferred, ...remaining]) {
    const match = findNormalizedQuote(page.text, parsed.exactQuote);
    if (!match) continue;
    const corrected = parsed.pageNumber && parsed.pageNumber !== page.pageNumber;
    return {
      ...base,
      pageNumber: page.pageNumber,
      charStart: match.start,
      charEnd: match.end,
      matchMethod: "normalized_exact",
      verificationStatus: corrected ? "page_corrected" : "verified"
    };
  }
  return base;
}

export function parseDocumentEvidence(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      pageNumber: positiveInteger(value.pageNumber ?? value.page ?? value.page_number),
      exactQuote: clean(value.exactQuote ?? value.quote ?? value.originalText ?? value.excerpt, 2400),
      location: clean(value.location, 300)
    };
  }
  const text = clean(value, 2400);
  const pageNumber = positiveInteger(text.match(/(?:第\s*|page\s*)(\d+)\s*(?:页)?/i)?.[1]);
  const quoted = text.match(/[“"]([^”"]{8,})[”"]/)?.[1]
    || text.match(/(?:原文|quote)\s*[:：]\s*(.{8,})$/i)?.[1]
    || "";
  return { pageNumber, exactQuote: clean(quoted, 2400), location: text };
}

export function findNormalizedQuote(text, quote) {
  const haystack = normalizeWithMap(text);
  const needle = normalizeComparable(quote);
  if (!needle) return null;
  const index = haystack.value.indexOf(needle);
  if (index < 0) return null;
  return {
    start: haystack.map[index] ?? 0,
    end: (haystack.map[index + needle.length - 1] ?? haystack.map[index] ?? 0) + 1
  };
}

function webCitation(source, { claimId, hashText }) {
  if (!source?.url) return null;
  const exactQuote = clean(source.snippet, 2400);
  const verifiedCapture = source.verificationStatus === "verified" && Boolean(source.contentHash);
  return {
    id: `web_${clean(source.id, 100) || hashText(source.url).slice(0, 12)}_${clean(claimId, 60)}`,
    sourceKind: "web",
    sourceId: clean(source.id, 100),
    sourcePath: clean(source.url, 2000),
    pageNumber: null,
    exactQuote,
    charStart: null,
    charEnd: null,
    matchMethod: verifiedCapture ? "captured_page_text" : "search_excerpt",
    verificationStatus: verifiedCapture ? "verified" : exactQuote ? "captured" : "unverified",
    retrievedAt: clean(source.retrievedAt, 100),
    contentHash: clean(source.contentHash, 128),
    evidenceHash: exactQuote ? hashText(evidenceFingerprint("web", source.url, "", exactQuote)) : ""
  };
}

function documentPages(document) {
  const pages = array(document?.pages).map((page, index) => ({
    pageNumber: positiveInteger(page?.page ?? page?.pageNumber) || index + 1,
    text: String(page?.text || "")
  })).filter((page) => page.text.trim());
  if (pages.length) return pages;
  const text = String(document?.text || "");
  const marker = /---\s*(?:第\s*)?(\d+)\s*(?:页|Page)?\s*---/gi;
  const matches = Array.from(text.matchAll(marker));
  if (!matches.length) return text.trim() ? [{ pageNumber: 1, text }] : [];
  return matches.map((match, index) => ({
    pageNumber: positiveInteger(match[1]) || index + 1,
    text: text.slice(match.index + match[0].length, matches[index + 1]?.index ?? text.length)
  }));
}

function normalizeWithMap(value) {
  const source = String(value || "");
  let normalized = "";
  const map = [];
  let previousSpace = false;
  for (let index = 0; index < source.length; index += 1) {
    const chars = source[index].normalize("NFKC").toLowerCase();
    for (const char of chars) {
      const isSpace = /\s/.test(char);
      if (isSpace && previousSpace) continue;
      normalized += isSpace ? " " : char;
      map.push(index);
      previousSpace = isSpace;
    }
  }
  return { value: normalized.trim(), map: trimMap(normalized, map) };
}

function trimMap(value, map) {
  const leading = value.length - value.trimStart().length;
  const trailing = value.length - value.trimEnd().length;
  return map.slice(leading, trailing ? map.length - trailing : undefined);
}

function normalizeComparable(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function evidenceFingerprint(kind, source, page, quote) {
  return [kind, clean(source, 2000), page || "", normalizeComparable(quote)].join("\n");
}

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function normalizeImportance(value) {
  return ["critical", "high", "medium", "low"].includes(value) ? value : "medium";
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function unique(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function clean(value, maxLength) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
