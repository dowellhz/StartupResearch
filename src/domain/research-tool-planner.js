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
