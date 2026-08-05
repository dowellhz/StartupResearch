import { REPORT_SECTIONS } from "./review-prompts.js";

export function buildFallbackReport({ companyName, analysis = {}, sources = [], warning = "" } = {}) {
  const claims = Array.isArray(analysis.claims) ? analysis.claims : [];
  const risks = Array.isArray(analysis.risks) ? analysis.risks : [];
  const missing = Array.isArray(analysis.missingInformation) ? analysis.missingInformation : [];
  const sections = new Map([
    ["核查结论摘要", `本次模型未能稳定输出完整长报告，系统已根据结构化提取结果生成可恢复报告。${warning}\n\n当前共提取 ${claims.length} 条 BP 声明、${risks.length} 项风险及 ${sources.length} 个公开来源。以下内容应视为阶段性核查结果。`],
    ["公司与产品", profileText(analysis.companyProfile)],
    ["团队与组织", claimsByDomain(claims, /团队|组织|创始|人员/)],
    ["市场规模与增长假设", claimsByDomain(claims, /市场|增长|规模/)],
    ["客户、收入与经营数据", claimsByDomain(claims, /客户|收入|经营|财务|出货/)],
    ["商业模式与单位经济", claimsByDomain(claims, /商业模式|单位经济|毛利|成本/)],
    ["竞争格局与差异化", claimsByDomain(claims, /竞争|差异|壁垒/)],
    ["技术与产品壁垒", claimsByDomain(claims, /技术|产品|专利|研发/)],
    ["融资诉求与资金用途", claimsByDomain(claims, /融资|资金|估值/)],
    ["关键声明核查表", claimsTable(claims)],
    ["核心风险与红旗", risksText(risks)],
    ["待核实信息与尽调问题", listText(missing, "需结合 BP 原文、公司底稿及第三方证据继续核实。")],
    ["建议与下一步", "建议优先核验高重要性声明，取得工商、财务、客户、技术及知识产权底稿后重新生成完整报告。模型长报告输出异常不代表 BP 声明为假。"],
    ["参考来源", sourcesText(sources)]
  ]);
  return `# ${companyName || "未识别公司"} BP 核查报告（阶段性）\n\n> 生成提示：长报告生成异常，系统保留已有分析并自动形成此阶段性版本。\n\n${REPORT_SECTIONS.map((section) => `## ${section}\n\n${sections.get(section) || "本次未形成可核验信息。"}`).join("\n\n")}`;
}

function profileText(profile = {}) {
  const values = [profile.oneLiner, profile.stage, profile.sector, profile.geography, profile.fundingAsk].filter(Boolean);
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "除 BP 中的主体信息外，本次未形成足够的独立核验证据。";
}

function claimsByDomain(claims, pattern) {
  const matched = claims.filter((claim) => pattern.test(String(claim.domain || "")));
  return matched.length ? matched.map((claim) => `- ${claim.statement}（BP 依据：${claim.bpEvidence || "未标注"}）`).join("\n") : "BP 未提供或结构化提取未识别到该维度的明确声明。";
}

function claimsTable(claims) {
  const rows = claims.slice(0, 30).map((claim) => `| ${tableCell(claim.statement)} | ${tableCell(claim.bpEvidence || "未标注")} | 本阶段未完成逐项公开核验 | 仅BP自述 | 中 | 补充原始底稿与第三方证据 |`);
  return ["| 声明 | BP依据 | 公开核验 | 判断 | 置信度 | 下一步 |", "|---|---|---|---|---|---|", ...(rows.length ? rows : ["| 未提取到明确声明 | 未提供 | 资料不足 | 资料不足 | 低 | 重新解析材料 |"])].join("\n");
}

function risksText(risks) {
  return risks.length ? risks.map((risk) => `- **${risk.category || "风险"}**：${risk.description || risk.basis || "需进一步核实"}`).join("\n") : "本阶段未形成结构化风险条目，不代表不存在风险。";
}

function listText(values, fallback) {
  return values.length ? values.map((value) => `- ${typeof value === "string" ? value : JSON.stringify(value)}`).join("\n") : fallback;
}

function sourcesText(sources) {
  return sources.length ? sources.slice(0, 24).map((source) => `- [${source.title || source.url}](${source.url})`).join("\n") : "本次未形成可引用的公开来源。";
}

function tableCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 500);
}
