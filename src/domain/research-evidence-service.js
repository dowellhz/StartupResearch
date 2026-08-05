const PRIMARY_HOST_PATTERNS = [
  /(^|\.)gov(?:\.cn)?$/,
  /(^|\.)edu\.cn$/,
  /(^|\.)ac\.cn$/,
  /(^|\.)clinicaltrials\.gov$/,
  /(^|\.)sec\.gov$/,
  /(^|\.)hkexnews\.hk$/,
  /(^|\.)cnipa\.gov\.cn$/,
  /(^|\.)samr\.gov\.cn$/,
  /(^|\.)doi\.org$/
];

const LOW_AUTHORITY_HOSTS = new Set([
  "baike.baidu.com",
  "xiaohongshu.com",
  "www.xiaohongshu.com",
  "tianyancha.com",
  "www.tianyancha.com",
  "m.qixin.com",
  "wx.qixin007.com",
  "gongshang.mingluji.com"
]);

export function normalizeEvidenceSources(sources = []) {
  const byUrl = new Map();
  for (const raw of Array.isArray(sources) ? sources : []) {
    const url = normalizeUrl(raw?.url);
    if (!url) continue;
    const next = {
      title: cleanText(raw.title || url, 500),
      url,
      snippet: cleanText(raw.snippet || raw.evidenceExcerpt || raw.citedText, 2000),
      supports: normalizeClaimIds(raw.supports),
      conflicts: normalizeClaimIds(raw.conflicts),
      publishedAt: cleanText(raw.publishedAt || raw.pageAge || raw.date, 100),
      sourceTier: normalizeSourceTier(raw.sourceTier) || classifySourceTier(url),
      retrievedAt: cleanText(raw.retrievedAt, 100)
    };
    const existing = byUrl.get(url);
    byUrl.set(url, existing ? mergeSource(existing, next) : next);
  }
  return Array.from(byUrl.values()).map((source, index) => ({ id: `source_${index + 1}`, ...source }));
}

export function buildEvidenceAssessment({ claims = [], sources = [] } = {}) {
  const normalizedSources = normalizeEvidenceSources(sources);
  const importantClaims = (Array.isArray(claims) ? claims : []).filter((claim) => ["critical", "high"].includes(claim?.importance));
  const coverage = importantClaims.map((claim) => {
    const supportedBy = [];
    const conflictedBy = [];
    const candidates = [];
    for (const source of normalizedSources) {
      if (source.supports.includes(claim.id)) supportedBy.push(source.id);
      if (source.conflicts.includes(claim.id)) conflictedBy.push(source.id);
      if (!supportedBy.includes(source.id) && !conflictedBy.includes(source.id) && hasCandidateOverlap(claim.statement, source)) {
        candidates.push(source.id);
      }
    }
    const status = conflictedBy.length ? "conflicted" : supportedBy.length ? "supported" : candidates.length ? "candidate" : "unverified";
    return {
      claimId: String(claim.id || ""),
      status,
      hasCandidateEvidence: status !== "unverified",
      supportedBy,
      conflictedBy,
      candidates
    };
  });
  const evidenceRichCount = normalizedSources.filter(hasEvidenceExcerpt).length;
  const authoritativeCount = normalizedSources.filter((source) => source.sourceTier !== "lead").length;
  const coveredCount = coverage.filter((item) => item.status !== "unverified").length;
  return {
    sources: normalizedSources,
    coverage,
    metrics: {
      sourceCount: normalizedSources.length,
      evidenceRichCount,
      evidenceRichRatio: ratio(evidenceRichCount, normalizedSources.length),
      authoritativeCount,
      authoritativeRatio: ratio(authoritativeCount, normalizedSources.length),
      importantClaimCount: importantClaims.length,
      coveredClaimCount: coveredCount,
      claimCoverageRatio: ratio(coveredCount, importantClaims.length)
    }
  };
}

export function classifySourceTier(value) {
  let host = "";
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return "lead";
  }
  if (PRIMARY_HOST_PATTERNS.some((pattern) => pattern.test(host))) return "primary";
  if (LOW_AUTHORITY_HOSTS.has(host) || /(^|\.)(weibo|zhihu|douyin)\.com$/.test(host)) return "lead";
  return "secondary";
}

export function hasEvidenceExcerpt(source) {
  return meaningfulTextLength(source?.snippet) >= 12;
}

function hasCandidateOverlap(statement, source) {
  if (!hasEvidenceExcerpt(source)) return false;
  const claimTokens = evidenceTokens(statement);
  if (!claimTokens.length) return false;
  const haystack = normalizeComparable(`${source.title} ${source.snippet}`);
  const matches = claimTokens.filter((token) => haystack.includes(token)).length;
  return matches >= Math.min(2, claimTokens.length);
}

function evidenceTokens(value) {
  const text = normalizeComparable(value);
  const latin = text.match(/[a-z0-9][a-z0-9.-]{2,}/g) || [];
  const chineseRuns = text.match(/[\u3400-\u9fff]{4,}/g) || [];
  const chinese = chineseRuns.flatMap((run) => {
    const values = [];
    for (let index = 0; index <= run.length - 4; index += 4) values.push(run.slice(index, index + 4));
    return values;
  });
  return Array.from(new Set([...latin, ...chinese])).slice(0, 12);
}

function mergeSource(left, right) {
  return {
    ...left,
    title: betterText(left.title, right.title),
    snippet: betterText(left.snippet, right.snippet),
    supports: Array.from(new Set([...left.supports, ...right.supports])),
    conflicts: Array.from(new Set([...left.conflicts, ...right.conflicts])),
    publishedAt: left.publishedAt || right.publishedAt,
    sourceTier: strongerTier(left.sourceTier, right.sourceTier),
    retrievedAt: left.retrievedAt || right.retrievedAt
  };
}

function normalizeClaimIds(value) {
  if (Array.isArray(value)) return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean))).slice(0, 30);
  return Array.from(new Set(String(value || "").match(/(?:claim|c)[_-]?\d+/gi) || [])).slice(0, 30);
}

function normalizeUrl(value) {
  const text = String(value || "").trim().replace(/[.,;，。；]+$/, "");
  if (!/^https?:\/\//i.test(text)) return "";
  try {
    return new URL(text).toString();
  } catch {
    return "";
  }
}

function normalizeSourceTier(value) {
  return ["primary", "secondary", "lead"].includes(value) ? value : "";
}

function strongerTier(left, right) {
  const rank = { primary: 3, secondary: 2, lead: 1 };
  return rank[right] > rank[left] ? right : left;
}

function betterText(left, right) {
  return meaningfulTextLength(right) > meaningfulTextLength(left) ? right : left;
}

function cleanText(value, maxLength) {
  const text = typeof value === "string" ? value : "";
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeComparable(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}

function meaningfulTextLength(value) {
  return normalizeComparable(value).length;
}

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 1000;
}
