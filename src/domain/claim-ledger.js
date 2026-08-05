export function buildClaimLedger({ claims = [], sources = [], coverage = [] } = {}) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const coverageByClaim = new Map(coverage.map((item) => [String(item.claimId || ""), item]));
  const cards = claims.slice(0, 100).map((claim, index) => {
    const id = String(claim?.id || `claim_${index + 1}`).trim();
    const assessment = coverageByClaim.get(id) || {};
    const supportingSources = linkedSources(sources, sourceById, assessment.supportedBy, "supports", id);
    const conflictingSources = linkedSources(sources, sourceById, assessment.conflictedBy, "conflicts", id);
    const candidateSources = linkedSources(sources, sourceById, assessment.candidates, "", id)
      .filter((source) => !supportingSources.some((item) => item.id === source.id) && !conflictingSources.some((item) => item.id === source.id));
    const status = claimStatus({ claim, supportingSources, conflictingSources, candidateSources });
    return {
      id,
      domain: clean(claim?.domain, 100),
      statement: clean(claim?.statement, 1200),
      bpEvidence: clean(claim?.bpEvidence, 1200),
      importance: normalizeImportance(claim?.importance),
      verificationNeed: clean(claim?.verificationNeed, 800),
      status,
      confidence: evidenceConfidence([...conflictingSources, ...supportingSources, ...candidateSources]),
      supportingSources,
      conflictingSources,
      candidateSources,
      nextAction: nextAction(claim, status)
    };
  });
  const counts = countBy(cards, (item) => item.status);
  return {
    claims: cards,
    summary: {
      total: cards.length,
      supported: counts.supported || 0,
      conflicted: counts.conflicted || 0,
      candidate: counts.candidate || 0,
      bpOnly: counts.bp_only || 0,
      insufficient: counts.insufficient || 0,
      highPriorityOpen: cards.filter((item) => ["critical", "high"].includes(item.importance) && !["supported", "conflicted"].includes(item.status)).length
    }
  };
}

function linkedSources(sources, sourceById, assessedIds = [], linkField, claimId) {
  const ids = new Set(Array.isArray(assessedIds) ? assessedIds : []);
  if (linkField) {
    for (const source of sources) {
      if ((source?.[linkField] || []).includes(claimId)) ids.add(source.id);
    }
  }
  return Array.from(ids).map((id) => sourceById.get(id)).filter(Boolean).map(sourceCard).slice(0, 12);
}

function sourceCard(source) {
  return {
    id: source.id,
    title: clean(source.title, 500),
    url: clean(source.url, 2000),
    snippet: clean(source.snippet, 1200),
    sourceTier: source.sourceTier || "lead",
    publishedAt: clean(source.publishedAt, 100),
    retrievedAt: clean(source.retrievedAt, 100)
  };
}

function claimStatus({ claim, supportingSources, conflictingSources, candidateSources }) {
  if (conflictingSources.length) return "conflicted";
  if (supportingSources.length) return "supported";
  if (candidateSources.length) return "candidate";
  return clean(claim?.bpEvidence, 1200) ? "bp_only" : "insufficient";
}

function evidenceConfidence(sources) {
  if (sources.some((source) => source.sourceTier === "primary")) return "high";
  if (sources.some((source) => source.sourceTier === "secondary")) return "medium";
  return "low";
}

function nextAction(claim, status) {
  const requested = clean(claim?.verificationNeed, 800);
  if (requested) return requested;
  if (status === "conflicted") return "取得公司底稿并逐项解释公开证据冲突";
  if (status === "supported") return "核对来源时点与统计口径，并在投前更新";
  if (status === "candidate") return "打开候选来源，确认其是否直接支持该声明";
  return "索取底层材料或取得独立第三方证据";
}

function normalizeImportance(value) {
  return ["critical", "high", "medium", "low"].includes(value) ? value : "medium";
}

function countBy(values, selector) {
  return values.reduce((counts, item) => {
    const key = selector(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function clean(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
