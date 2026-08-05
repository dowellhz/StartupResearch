const CLINICAL_PATTERN = /生物医药|制药|药物|抗体|小分子|siRNA|核酸|临床|适应症|IND|PCC|肿瘤|代谢疾病/i;
const SCHOLAR_PATTERN = /教授|博士|院士|高校|大学|研究院|论文|学术|科研|课题|实验室|专利发明人/i;

const VERIFICATION_PACKS = [
  { id: "corporate", label: "工商与主体", pattern: /公司|主体|工商|成立|股东|融资|注册/i, sourcePriorities: ["国家企业信用信息公示系统", "交易所或监管披露", "公司官网"] },
  { id: "team", label: "团队身份", pattern: /团队|创始|高管|履历|教授|博士|顾问/i, sourcePriorities: ["任职机构官网", "高校或研究机构官网", "权威媒体访谈"] },
  { id: "commercial", label: "客户与商业验证", pattern: /客户|收入|合同|订单|合作|出货|GMV|ARR|MRR/i, sourcePriorities: ["客户官网或公告", "招投标与采购公告", "审计或监管披露"] },
  { id: "market", label: "市场基准", pattern: /市场|TAM|SAM|SOM|增长|渗透|规模/i, sourcePriorities: ["政府统计", "行业协会", "上市公司年报"] },
  { id: "competition", label: "竞争与替代方案", pattern: /竞争|竞品|替代|差异化|份额/i, sourcePriorities: ["竞品官网与年报", "客户采购材料", "行业协会"] },
  { id: "ip", label: "知识产权", pattern: /专利|知识产权|核心技术|软著|论文/i, sourcePriorities: ["国家知识产权局", "WIPO 或 Google Patents", "论文数据库"] },
  { id: "regulatory", label: "监管与临床", pattern: /临床|药物|医疗器械|IND|NCT|注册证|牌照|合规|监管/i, sourcePriorities: ["药监或主管部门", "ClinicalTrials.gov 或登记平台", "公司公告"] },
  { id: "legal", label: "诉讼与重大风险", pattern: /诉讼|处罚|失信|争议|侵权|法律风险/i, sourcePriorities: ["裁判文书与法院公告", "监管处罚", "企业信用公示"] }
];

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
  const verificationPacks = buildVerificationPacks(analysis, { companyName });
  const searchQueries = unique([
    ...modelQueries.slice(0, 2),
    ...verificationPacks.slice(0, 3).map((item) => item.query),
    ...claimPlans.map((item) => item.query),
    ...modelQueries.slice(2),
    companyName ? `${companyName} 公司 团队 产品 融资` : ""
  ]).slice(0, maxQueries);
  const domains = Array.from(new Set(claims.map((claim) => String(claim.domain || "").trim()).filter(Boolean)));
  const criticalClaims = claims.filter((claim) => ["critical", "high"].includes(claim.importance));
  return {
    domains,
    criticalClaims,
    claimPlans,
    verificationPacks,
    searchQueries,
    coverageTargets: claimPlans.filter((item) => ["critical", "high"].includes(item.priority)).map((item) => item.claimId),
    requestedTools: planReviewResearchTools(analysis)
  };
}

export function buildVerificationPacks(analysis = {}, { companyName = "" } = {}) {
  const claims = Array.isArray(analysis.claims) ? analysis.claims : [];
  const material = [
    analysis.companyProfile?.sector,
    analysis.companyProfile?.oneLiner,
    ...claims.flatMap((claim) => [claim.domain, claim.statement, claim.verificationNeed])
  ].filter(Boolean).join(" ");
  return VERIFICATION_PACKS
    .filter((pack) => pack.id === "corporate" || pack.pattern.test(material))
    .slice(0, 6)
    .map((pack) => {
      const matchedClaims = claims.filter((claim) => pack.pattern.test([claim.domain, claim.statement, claim.verificationNeed].filter(Boolean).join(" ")));
      const claimIds = matchedClaims
        .map((claim) => String(claim.id || "").trim()).filter(Boolean).slice(0, 12);
      const target = String(companyName || matchedClaims[0]?.statement || "").trim().slice(0, 250);
      return {
        id: pack.id,
        label: pack.label,
        claimIds,
        sourcePriorities: [...pack.sourcePriorities],
        query: target ? [target, pack.label, pack.sourcePriorities.slice(0, 2).join(" ")].join(" ").slice(0, 500) : ""
      };
    });
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
