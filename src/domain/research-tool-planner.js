const CLINICAL_PATTERN = /生物医药|制药|药物|抗体|小分子|siRNA|核酸|临床|适应症|IND|PCC|肿瘤|代谢疾病/i;
const SCHOLAR_PATTERN = /教授|博士|院士|高校|大学|研究院|论文|学术|科研|课题|实验室|专利发明人/i;

export function planReviewResearchTools(analysis = {}) {
  const claims = Array.isArray(analysis.claims) ? analysis.claims : [];
  const material = [
    analysis.companyProfile?.sector,
    analysis.companyProfile?.oneLiner,
    ...claims.flatMap((claim) => [claim.domain, claim.statement, claim.verificationNeed])
  ].filter(Boolean).join(" ");
  const tools = ["general_web_search"];
  if (CLINICAL_PATTERN.test(material)) tools.push("clinical_trials_search");
  if (SCHOLAR_PATTERN.test(material)) tools.push("google_scholar_search");
  return tools;
}

export function buildReviewResearchPlan(analysis = {}, { companyName = "", maxQueries = 8, maxClaims = 16 } = {}) {
  const claims = Array.isArray(analysis.claims) ? analysis.claims : [];
  const orderedClaims = prioritizeAcrossDomains(claims).slice(0, maxClaims);
  const claimPlans = orderedClaims.map((claim, index) => ({
    claimId: String(claim.id || `claim_${index + 1}`),
    domain: String(claim.domain || "其他").trim(),
    priority: normalizeImportance(claim.importance),
    objective: String(claim.verificationNeed || claim.statement || "核验 BP 声明").trim().slice(0, 600),
    query: claimQuery(companyName, claim)
  }));
  const modelQueries = Array.isArray(analysis.searchQueries)
    ? analysis.searchQueries.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const searchQueries = unique([
    ...modelQueries.slice(0, 3),
    ...claimPlans.map((item) => item.query),
    ...modelQueries.slice(3),
    companyName ? `${companyName} 公司 团队 产品 融资` : ""
  ]).slice(0, maxQueries);
  const domains = Array.from(new Set(claims.map((claim) => String(claim.domain || "").trim()).filter(Boolean)));
  const criticalClaims = claims.filter((claim) => ["critical", "high"].includes(claim.importance));
  return {
    domains,
    criticalClaims,
    claimPlans,
    searchQueries,
    coverageTargets: claimPlans.filter((item) => ["critical", "high"].includes(item.priority)).map((item) => item.claimId),
    requestedTools: planReviewResearchTools(analysis)
  };
}

function prioritizeAcrossDomains(claims) {
  const result = [];
  for (const importance of ["critical", "high", "medium", "low"]) {
    const tier = claims.filter((claim) => normalizeImportance(claim?.importance) === importance);
    const firstByDomain = [];
    const remaining = [];
    const seen = new Set();
    for (const claim of tier) {
      const domain = String(claim?.domain || "其他");
      if (!seen.has(domain)) {
        seen.add(domain);
        firstByDomain.push(claim);
      } else remaining.push(claim);
    }
    result.push(...firstByDomain, ...remaining);
  }
  return result;
}

function claimQuery(companyName, claim) {
  return [companyName, claim?.verificationNeed || claim?.statement]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
}

function normalizeImportance(value) {
  return ["critical", "high", "medium", "low"].includes(value) ? value : "medium";
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
