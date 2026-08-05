export const COMPANY_RESEARCH_SECTIONS = [
  "预研结论摘要",
  "主体与公司概况",
  "产品与技术",
  "团队与组织",
  "市场与竞争",
  "客户与商业进展",
  "融资与资本",
  "公开风险与待核实事项",
  "投资关注点与下一步",
  "参考来源"
];

export function buildCompanyResearchExtractionMessages({ companyName, instruction, sources }) {
  return [
    {
      role: "system",
      content: [
        "你是为投资团队服务的公司公开信息研究员，只输出合法 JSON。",
        "只能基于输入的公开来源整理事实，不得把未检索到的信息写成不存在，不得补造公司、团队、融资、客户或技术信息。",
        "输出格式：{companyProfile,findings,risks,missingInformation,followupQuestions}。",
        "companyProfile 包含 legalName、brands、oneLiner、sector、geography、foundedAt、stage；无法确认的字段返回空字符串或空数组。",
        "findings 每项包含 id、domain、statement、sourceIds、confidence、nature。",
        "domain 应覆盖来源实际涉及的主体、产品、技术、团队、市场、客户、融资、知识产权、监管或风险。",
        "sourceIds 只能引用输入 sources 中存在的 id；confidence 只能是 high、medium、low；nature 只能是 public_fact、company_claim、third_party_report、inference。",
        "risks 每项包含 category、description、basisSourceIds、severity、nextStep；severity 只能是 high、medium、low。",
        "missingInformation 和 followupQuestions 必须是可执行的尽调缺口与问题。",
        "所有面向用户的自然语言字段使用简体中文。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        companyName: String(companyName || "").slice(0, 300),
        instruction: String(instruction || "").slice(0, 3000),
        sources: compactSources(sources, 32)
      })
    }
  ];
}

export function buildCompanyResearchReportMessages({ companyName, instruction, scope, analysis, sources, researchWarning }) {
  return [
    {
      role: "system",
      content: [
        "你是为投资团队服务的高级公司预研分析师，输出完整中文 Markdown 报告。",
        "本任务没有 BP；报告仅基于公开来源及明确标记的分析推断。不得提及‘BP 未披露’或假装已读取附件。",
        "公司官网、公众号等公司自有来源属于公司自述；第三方报道不是权威确认；重要结论必须区分事实、自述、第三方信息和推断。",
        "不得把检索不到信息升级成不存在、造假或零收入。来源不足时写‘本次公开检索未形成可核验证据’。",
        "引用公开网页时使用 [来源标题](URL)，URL 只能来自输入 sources。",
        "开头给出一句总判断和 4-6 条预研要点；结尾给出按优先级排序的补充材料和访谈清单。",
        `以下 ${COMPANY_RESEARCH_SECTIONS.length} 个二级标题必须各出现一次：${COMPANY_RESEARCH_SECTIONS.map((item) => `## ${item}`).join("；")}`,
        "参考来源必须列出本次实际使用的来源，不要输出代码围栏或生成过程。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        companyName: String(companyName || "").slice(0, 300),
        instruction: String(instruction || "").slice(0, 3000),
        researchScope: scope,
        structuredAnalysis: analysis,
        researchWarning: String(researchWarning || "").slice(0, 1000),
        sources: compactSources(sources, 32)
      })
    }
  ];
}

export function buildCompanyResearchFallback({ companyName, analysis = {}, sources = [], warning = "" }) {
  const profile = analysis.companyProfile || {};
  const findings = array(analysis.findings);
  const risks = array(analysis.risks);
  const sourceLines = sources.length
    ? sources.map((source) => `- [${source.title}](${source.url})${source.snippet ? ` — ${source.snippet}` : ""}`).join("\n")
    : "本次公开检索未形成可引用来源。";
  const sections = {
    "预研结论摘要": warning || `已围绕 ${companyName} 完成公开信息初步检索；结论仅供投资预研，关键商业数据仍需公司材料验证。`,
    "主体与公司概况": profile.oneLiner || profile.legalName || "公开资料不足，尚无法稳定确认完整法定主体与公司阶段。",
    "产品与技术": findingLines(findings, /产品|技术|知识产权/),
    "团队与组织": findingLines(findings, /团队|组织|创始|高管/),
    "市场与竞争": findingLines(findings, /市场|竞争|行业/),
    "客户与商业进展": findingLines(findings, /客户|商业|收入|合作|订单/),
    "融资与资本": findingLines(findings, /融资|资本|股东|主体/),
    "公开风险与待核实事项": risks.length ? risks.map((item) => `- ${item.description || item.category}`).join("\n") : "- 本次公开资料不足以排除重大风险，需继续核实主体、客户、财务和合规信息。",
    "投资关注点与下一步": array(analysis.followupQuestions).length ? array(analysis.followupQuestions).map((item) => `- ${item}`).join("\n") : "- 索取公司主体证明、核心团队履历、客户合同、财务数据和融资历史并逐项核验。",
    "参考来源": sourceLines
  };
  return `# ${companyName} 公司预研报告\n\n${COMPANY_RESEARCH_SECTIONS.map((section) => `## ${section}\n\n${sections[section]}`).join("\n\n")}`;
}

function compactSources(sources, limit) {
  return array(sources).slice(0, limit).map((source) => ({
    id: source.id,
    title: String(source.title || "").slice(0, 500),
    url: source.url,
    snippet: String(source.snippet || "").slice(0, 1800),
    publishedAt: source.publishedAt,
    sourceTier: source.sourceTier,
    provider: source.provider
  }));
}

function findingLines(findings, pattern) {
  const matched = findings.filter((item) => pattern.test(String(item.domain || "")));
  return matched.length ? matched.map((item) => `- ${item.statement}`).join("\n") : "本次公开检索未形成可核验证据。";
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
