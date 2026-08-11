const CLINICAL_PATTERN = /生物医药|制药|药物|抗体|小分子|siRNA|核酸|临床|适应症|IND|PCC|肿瘤|医疗器械|神经调控|神经刺激|脑机|脑电|近红外|EEG|fNIRS|temporal interference|\bTI\b|\bNCT\d{8}\b/i;
const SCHOLAR_PATTERN = /教授|博士|院士|高校|大学|研究院|论文|学术|学者|科研|课题|实验室|DOI|ORCID|Google\s*Scholar/i;
const ARXIV_PATTERN = /arXiv|预印本|论文|学术|科研|教授|博士|学者|高校|大学|研究院|实验室|Google\s*Scholar|算法|模型|人工智能|\bAI\b|机器学习|深度学习|神经网络|计算机视觉|自然语言|核心技术|技术架构/i;
const SOFTWARE_PATTERN = /软件|SaaS|开源|代码|算法|开发者|GitHub|仓库|机器人|人工智能|\bAI\b|大模型|模型|数据集/i;
const AI_ASSET_PATTERN = /人工智能|\bAI\b|大模型|基础模型|模型权重|数据集|Hugging\s*Face|transformer/i;
const SECURITY_PATTERN = /漏洞|安全|依赖|供应链安全|CVE-\d{4}-\d+|\b(?:npm|pypi|maven|cargo):/i;
const SEC_PATTERN = /SEC|EDGAR|10-K|10-Q|8-K|20-F|6-K|S-1|F-1|美股|美国上市|上市公司披露/i;
const TED_PATTERN = /TED|欧盟|欧洲|海外.{0,10}(?:招标|采购|中标)|国际.{0,10}(?:招标|采购|中标)/i;

export const STRUCTURED_RESEARCH_TOOLS = Object.freeze([
  tool("clinical_trials_search", "ClinicalTrials.gov API", "检索官方临床试验登记、阶段、状态、申办方、入组和终点"),
  tool("arxiv_paper_search", "arXiv 论文", "检索 arXiv 预印本的标题、作者、摘要、分类、发布日期和原文链接"),
  tool("scholarly_works_search", "Crossref 学术文献", "检索论文 DOI、作者、机构线索、期刊、引用与更新信息"),
  tool("openalex_research_search", "OpenAlex 学术图谱", "核验论文作者、研究机构、成果归属、引用和研究方向"),
  tool("github_repository_search", "GitHub 公开仓库", "检索公开代码仓库、技术栈、活跃度、版本与社区信号"),
  tool("huggingface_asset_search", "Hugging Face 公开资产", "检索公开模型、数据集、更新时间和下载信号"),
  tool("software_vulnerability_search", "OSV / NVD 漏洞库", "按 CVE、包名、版本或技术关键词检索公开漏洞记录"),
  tool("sec_filing_search", "SEC EDGAR", "检索美国上市主体及其 10-K、10-Q、8-K、20-F 等正式披露"),
  tool("procurement_notice_search", "TED 欧盟采购公告", "检索欧盟公开招投标、采购方和中标方记录")
]);

export function planStructuredResearchTools(value = "") {
  const text = String(value || "");
  const names = [];
  if (CLINICAL_PATTERN.test(text)) names.push("clinical_trials_search");
  if (ARXIV_PATTERN.test(text)) names.push("arxiv_paper_search");
  if (SCHOLAR_PATTERN.test(text)) names.push("scholarly_works_search");
  if (SCHOLAR_PATTERN.test(text)) names.push("openalex_research_search");
  if (SOFTWARE_PATTERN.test(text)) names.push("github_repository_search");
  if (AI_ASSET_PATTERN.test(text)) names.push("huggingface_asset_search");
  if (SECURITY_PATTERN.test(text)) names.push("software_vulnerability_search");
  if (SEC_PATTERN.test(text)) names.push("sec_filing_search");
  if (TED_PATTERN.test(text)) names.push("procurement_notice_search");
  return names;
}

export function researchToolDefinition(name) {
  return STRUCTURED_RESEARCH_TOOLS.find((item) => item.name === name) || null;
}

export function researchToolNames() {
  return STRUCTURED_RESEARCH_TOOLS.map((item) => item.name);
}

function tool(name, label, description) {
  return Object.freeze({ name, label, description });
}
