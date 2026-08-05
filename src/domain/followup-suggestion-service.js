const TECHNICAL_PATTERN = /技术|专利|产品|研发|算法|模型|材料|药物|临床|试验|工艺|硬件|软件|平台|壁垒/i;
const CLINICAL_PATTERN = /临床试验|临床研究|适应症|创新药|药物|制药|医药|医疗器械|生物医药|监管申报|\b(?:IND|NDA|BLA|PCC)\b/i;

const TECHNICAL_QUESTIONS = [
  "核心技术｜公司的核心技术由哪些模块构成，哪些属于自研并真正形成壁垒？",
  "技术验证｜需要追问哪些性能指标、基准测试和第三方验证证据？",
  "行业研究｜所在行业有哪些主要技术路线、竞争格局和未来三年趋势？",
  "商业化｜核心技术从研发走向规模化落地，还存在哪些工程、成本与交付风险？"
];

const CLINICAL_QUESTIONS = [
  "核心技术｜公司的核心技术、候选管线和知识产权分别处于什么阶段？",
  "技术验证｜临床前、临床试验与监管申报还缺哪些关键数据和证据？",
  "行业研究｜该适应症的竞争管线、标准疗法和未来三年格局如何变化？",
  "商业化｜从研发、注册到市场准入，最可能影响价值兑现的环节是什么？"
];

const BUSINESS_QUESTIONS = [
  "核心能力｜公司的核心能力或核心技术是什么，哪些真正形成差异化壁垒？",
  "商业验证｜客户、收入和订单的真实性应如何进一步验证？",
  "行业研究｜所在行业的竞争格局、增长驱动和未来三年趋势是什么？",
  "尽调建议｜如果只能优先核实三件事，应该核实什么？"
];

export function buildFollowupSuggestions({ analysis = {}, quality = {} } = {}) {
  const riskText = (analysis.risks || [])
    .map((risk) => [risk.category, risk.description, risk.basis].filter(Boolean).join(" "))
    .join(" ");
  const missingText = (analysis.missingInformation || []).map(String).join(" ");
  const findingText = (quality.findings || [])
    .map((finding) => typeof finding === "string" ? finding : finding?.message)
    .filter(Boolean)
    .join(" ");
  const claimText = (analysis.claims || [])
    .map((claim) => [claim.domain, claim.statement, claim.verificationNeed].filter(Boolean).join(" "))
    .join(" ");
  const profileText = Object.values(analysis.companyProfile || {}).filter((value) => typeof value === "string").join(" ");
  const context = `${profileText} ${claimText} ${riskText} ${missingText} ${findingText}`;
  if (CLINICAL_PATTERN.test(context)) return CLINICAL_QUESTIONS;
  if (TECHNICAL_PATTERN.test(context)) return TECHNICAL_QUESTIONS;
  return BUSINESS_QUESTIONS;
}

export function normalizeFollowupSuggestions(values) {
  return uniqueQuestions(Array.isArray(values) ? values : []).slice(0, 4);
}

function uniqueQuestions(values) {
  return Array.from(new Set(values
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 6 && value.length <= 80)));
}
