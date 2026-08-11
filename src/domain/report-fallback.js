import { REPORT_SECTIONS, REPORT_SECTIONS_EN } from "./review-prompts.js";
import { isEnglishOutput } from "./report-language.js";

export function buildFallbackReport({ companyName, analysis = {}, businessAudit = {}, claimLedger = {}, investmentAnalysis = {}, technologyResearch = {}, comparableCompanyResearch = {}, sources = [], warning = "", outputLanguage = "zh" } = {}) {
  if (isEnglishOutput(outputLanguage)) return buildEnglishFallback({ companyName, analysis, technologyResearch, comparableCompanyResearch, sources, warning });
  investmentAnalysis ||= {};
  const claims = Array.isArray(analysis.claims) ? analysis.claims : [];
  const risks = Array.isArray(analysis.risks) ? analysis.risks : [];
  const missing = Array.isArray(analysis.missingInformation) ? analysis.missingInformation : [];
  const sections = new Map([
    ["核查结论摘要", `本次模型未能稳定输出完整长报告，系统已根据结构化提取结果生成可恢复报告。${warning}\n\n当前共提取 ${claims.length} 条 BP 声明、${risks.length} 项风险及 ${sources.length} 个公开来源。以下内容应视为阶段性核查结果。`],
    ["公司与产品", profileText(analysis.companyProfile)],
    ["团队与组织", claimsByDomain(claims, /团队|组织|创始|人员/)],
    ["市场规模与增长假设", marketSizingText(investmentAnalysis.marketSizing) || claimsByDomain(claims, /市场|增长|规模/)],
    ["客户、收入与经营数据", claimsByDomain(claims, /客户|收入|经营|财务|出货/)],
    ["商业模式与单位经济", claimsByDomain(claims, /商业模式|单位经济|毛利|成本/)],
    ["竞争格局与差异化", comparableCompanyResearch.invoked ? comparableCompanyText(comparableCompanyResearch) : competitorText(investmentAnalysis.competitorMatrix) || claimsByDomain(claims, /竞争|差异|壁垒/)],
    ["技术与产品壁垒", technologyResearch.invoked ? technologyText(technologyResearch) : claimsByDomain(claims, /技术|产品|专利|研发/)],
    ["融资诉求与资金用途", claimsByDomain(claims, /融资|资金|估值/)],
    ["数字与经营假设审计", auditText(businessAudit)],
    ["投资判断与关键里程碑", decisionText(investmentAnalysis.decision)],
    ["新版 BP 变化", versionText(investmentAnalysis.versionComparison)],
    ["关键声明核查表", claimsTable(claims, claimLedger)],
    ["核心风险与红旗", risksText(risks)],
    ["待核实信息与尽调问题", listText(missing, "需结合 BP 原文、公司底稿及第三方证据继续核实。")],
    ["建议与下一步", "建议优先核验高重要性声明，取得工商、财务、客户、技术及知识产权底稿后重新生成完整报告。模型长报告输出异常不代表 BP 声明为假。"],
    ["参考来源", sourcesText(sources)]
  ]);
  return `# ${companyName || "未识别公司"} BP 核查报告（阶段性）\n\n> 生成提示：长报告生成异常，系统保留已有分析并自动形成此阶段性版本。\n\n${REPORT_SECTIONS.map((section) => `## ${section}\n\n${sections.get(section) || "本次未形成可核验信息。"}`).join("\n\n")}`;
}

function buildEnglishFallback({ companyName, analysis = {}, technologyResearch = {}, comparableCompanyResearch = {}, sources = [], warning = "" }) {
  const claims = Array.isArray(analysis.claims) ? analysis.claims : [];
  const risks = Array.isArray(analysis.risks) ? analysis.risks : [];
  const references = sources.length ? sources.slice(0, 24).map((source) => `- [${source.title || source.url}](${source.url})`).join("\n") : "No usable public sources were produced in this run.";
  const generic = "The available material is insufficient for a definitive conclusion. Verify this area using primary documents and independent due diligence.";
  const sections = Object.fromEntries(REPORT_SECTIONS_EN.map((section) => [section, generic]));
  sections["Review Conclusion Summary"] = `The model could not produce a stable full-length report, so the system retained a recoverable preliminary report from the structured results. ${warning}\n\nThe run extracted ${claims.length} BP claims, ${risks.length} risks, and ${sources.length} public sources.`;
  sections["Company and Product"] = [analysis.companyProfile?.oneLiner, analysis.companyProfile?.stage, analysis.companyProfile?.sector].filter(Boolean).map((item) => `- ${item}`).join("\n") || generic;
  sections["Key Claims Verification Table"] = "| Claim | BP Evidence | Public Verification | Assessment | Confidence | Next Step |\n|---|---|---|---|---|---|\n| Key operating and market claims | See uploaded material | Insufficient evidence in this run | BP-only | Low | Obtain underlying data and independent evidence |";
  sections["Core Risks and Red Flags"] = risks.length ? risks.map((risk) => `- **${risk.category || "Risk"}**: ${risk.description || risk.basis || "Further verification required"}`).join("\n") : generic;
  if (technologyResearch.invoked) sections["Technology and Product Moat"] = technologyText(technologyResearch, true);
  if (comparableCompanyResearch.invoked) sections["Competitive Landscape and Differentiation"] = comparableCompanyText(comparableCompanyResearch, true);
  sections["Recommendations and Next Steps"] = "Prioritize high-importance claims and obtain corporate, financial, customer, technical, and intellectual-property records for verification.";
  sections.References = references;
  return `# ${companyName || "Unidentified Company"} BP Review Report (Preliminary)\n\n> Generation note: the full-report generation failed, so this recoverable preliminary version preserves the available analysis.\n\n${REPORT_SECTIONS_EN.map((section) => `## ${section}\n\n${sections[section]}`).join("\n\n")}`;
}

function technologyText(value, english = false) {
  const synthesis = value.synthesis || {};
  return [
    `- **${english ? "Technology research topic" : "技术调研主题"}**：${value.plan?.topic || (english ? "Core technology" : "核心技术")}`,
    `- **${english ? "Maturity" : "成熟度"}**：${synthesis.maturity?.stage || "unknown"}${synthesis.maturity?.basis ? ` — ${synthesis.maturity.basis}` : ""}`,
    ...array(synthesis.findings).slice(0, 6).map((item) => `- ${item.statement || item}`),
    ...array(synthesis.bottlenecks).slice(0, 5).map((item) => `- ${english ? "Bottleneck" : "工程瓶颈"}：${item}`),
    ...array(synthesis.validationPlan).slice(0, 4).map((item) => `- ${english ? "Validation" : "验证"}：${item.hypothesis || item.method || JSON.stringify(item)}`)
  ].join("\n");
}

function comparableCompanyText(value, english = false) {
  const synthesis = value.synthesis || {};
  const peerLines = (label, peers) => array(peers).slice(0, 8).map((peer) =>
    `- **${label} · ${peer.name}**（${peer.relationship || "adjacent"}）：${peer.product || peer.differentiation || (english ? "Further evidence required" : "详细对比仍需补证")}`);
  return [
    `- **${english ? "Comparable scope" : "可比口径"}**：${value.plan?.scope || (english ? "Not established" : "尚未稳定建立")}`,
    ...peerLines(english ? "Domestic" : "国内", synthesis.domesticPeers),
    ...peerLines(english ? "International" : "海外", synthesis.internationalPeers),
    ...peerLines(english ? "Alternative" : "替代方案", synthesis.alternatives),
    ...array(synthesis.subjectPositioning).slice(0, 6).map((item) => `- ${english ? "Positioning" : "相对定位"}：${item}`),
    ...array(synthesis.gaps).slice(0, 5).map((item) => `- ${english ? "Evidence gap" : "证据缺口"}：${item}`)
  ].join("\n");
}

function marketSizingText(market = {}) {
  const scenarios = Array.isArray(market.scenarios) ? market.scenarios : [];
  const gaps = Array.isArray(market.gaps) ? market.gaps : [];
  if (!market.method && !market.formula && !scenarios.length && !gaps.length) return "";
  return [
    `- **状态**：${{ reconstructed: "已重建", partial: "部分重建", not_calculable: "无法测算" }[market.status] || "无法测算"}`,
    market.method ? `- **方法**：${market.method}` : "",
    market.formula ? `- **公式**：${market.formula}` : "",
    ...scenarios.map((item) => `- **${item.name || "情景"}**：${item.result || "待验证"}（${item.formula || "公式未形成"}）`),
    ...gaps.map((item) => `- 待补参数：${item}`)
  ].filter(Boolean).join("\n");
}

function competitorText(matrix = {}) {
  const dimensions = Array.isArray(matrix.dimensions) ? matrix.dimensions : [];
  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
  if (!rows.length) return "";
  const headers = ["竞品/替代方案", "关系", ...dimensions];
  const divider = headers.map(() => "---");
  const body = rows.map((item) => [item.name, item.relationship, ...dimensions.map((dimension) => item.values?.[dimension] || "资料不足")]);
  return [headers, divider, ...body].map((row) => `| ${row.map(tableCell).join(" | ")} |`).join("\n");
}

function decisionText(decision = {}) {
  const stance = { positive: "倾向推进", conditional: "有条件推进", negative: "不建议推进", insufficient: "证据不足" }[decision.stance] || "证据不足";
  const vetoItems = Array.isArray(decision.vetoItems) ? decision.vetoItems : [];
  const milestones = Array.isArray(decision.milestones) ? decision.milestones : [];
  return [
    `- **当前判断**：${stance}`,
    ...vetoItems.map((item) => `- **否决条件**：${item.condition}；核验：${item.verification || "补充底稿"}`),
    ...milestones.map((item) => `- **关键里程碑**：${item}`)
  ].join("\n");
}

function versionText(version = {}) {
  if (!version.available) return version.summary || "首次核查，无历史 BP 可比。";
  const changes = Array.isArray(version.changes) ? version.changes : [];
  if (!changes.length) return version.summary || "存在历史版本，但本次未形成可证实的结构化变化。";
  return ["| 字段 | 上一版 | 当前版 | 重要性 | 依据 |", "|---|---|---|---|---|", ...changes.map((item) => `| ${tableCell(item.field)} | ${tableCell(item.previous)} | ${tableCell(item.current)} | ${tableCell(item.significance)} | ${tableCell(item.basis)} |`)].join("\n");
}

function profileText(profile = {}) {
  const values = [profile.oneLiner, profile.stage, profile.sector, profile.geography, profile.fundingAsk].filter(Boolean);
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "除 BP 中的主体信息外，本次未形成足够的独立核验证据。";
}

function claimsByDomain(claims, pattern) {
  const matched = claims.filter((claim) => pattern.test(String(claim.domain || "")));
  return matched.length ? matched.map((claim) => `- ${claim.statement}（BP 依据：${evidenceLabel(claim.bpEvidence)}）`).join("\n") : "BP 未提供或结构化提取未识别到该维度的明确声明。";
}

function claimsTable(claims, ledger) {
  const cards = Array.isArray(ledger?.claims) && ledger.claims.length ? ledger.claims : claims;
  const rows = cards.slice(0, 30).map((claim) => `| ${tableCell(claim.statement)} | ${tableCell(evidenceLabel(claim.bpEvidence))} | ${tableCell(sourceSummary(claim))} | ${claimJudgment(claim.status)} | ${claim.confidence || "低"} | ${tableCell(claim.nextAction || claim.verificationNeed || "补充原始底稿与第三方证据")} |`);
  return ["| 声明 | BP依据 | 公开核验 | 判断 | 置信度 | 下一步 |", "|---|---|---|---|---|---|", ...(rows.length ? rows : ["| 未提取到明确声明 | 未提供 | 资料不足 | 资料不足 | 低 | 重新解析材料 |"])].join("\n");
}

function auditText(audit) {
  const checks = Array.isArray(audit?.checks) ? audit.checks : [];
  const rows = checks.slice(0, 30).map((item) => `| ${tableCell(item.description)} | ${tableCell(item.formula || "未形成公式")} | ${tableCell(item.result || "无法复算")} | ${auditStatus(item.status)} | ${tableCell(item.bpEvidence || "未标注")} | ${tableCell(item.nextStep || "取得底层数据复核")} |`);
  if (!rows.length) return "BP 未提供足以形成确定性复算的结构化数字，需补充财务、客户或经营底表。";
  return ["| 检查事项 | 公式 | 复算结果 | 状态 | BP依据 | 下一步 |", "|---|---|---|---|---|---|", ...rows].join("\n");
}

function sourceSummary(claim) {
  if (claim?.conflictingSources?.length) return `存在 ${claim.conflictingSources.length} 个冲突来源`;
  if (claim?.supportingSources?.length) return `${claim.supportingSources.length} 个公开来源支持`;
  if (claim?.candidateSources?.length) return `${claim.candidateSources.length} 个候选来源待确认`;
  return "本阶段未形成直接公开证据";
}

function claimJudgment(status) {
  return { supported: "公开支持", conflicted: "存在冲突", candidate: "资料不足", bp_only: "仅BP自述", insufficient: "资料不足" }[status] || "仅BP自述";
}

function auditStatus(status) {
  return { consistent: "一致", conflict: "存在冲突", uncertain: "资料不足", not_calculable: "无法复算" }[status] || "资料不足";
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

function evidenceLabel(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return String(value || "未标注");
  const page = Number(value.pageNumber || value.page || value.page_number) > 0 ? `第 ${Number(value.pageNumber || value.page || value.page_number)} 页` : "页码未核验";
  const quote = String(value.exactQuote || value.quote || "").replace(/\s+/g, " ").trim();
  return quote ? `${page}：“${quote}”` : page;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
