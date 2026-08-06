const BP_SUMMARY_HEADING = "核查结论摘要";
const COMPANY_SUMMARY_HEADING = "预研结论摘要";

export function ensureLeadingSummary(markdown, { heading, aliases = [], fallback } = {}) {
  const text = String(markdown || "").trim();
  const canonicalHeading = String(heading || "").trim();
  if (!canonicalHeading) return text;

  const acceptedHeadings = new Set([canonicalHeading, ...aliases].map(normalizeHeading));
  const sections = parseSecondLevelSections(text);
  const summarySections = sections.filter((section) => acceptedHeadings.has(normalizeHeading(section.heading)));
  const existingBody = summarySections.map((section) => section.body).find(hasMeaningfulSummary) || "";
  const summaryBody = existingBody || String(fallback || "").trim() || "现有证据不足，需在后续尽调中补充核实。";

  if (!sections.length) return insertAfterTitle(text, canonicalHeading, summaryBody);

  const preamble = text.slice(0, sections[0].start).trim();
  const remainingSections = sections
    .filter((section) => !acceptedHeadings.has(normalizeHeading(section.heading)))
    .map((section) => section.raw.trim())
    .filter(Boolean);
  return [preamble, `## ${canonicalHeading}\n\n${summaryBody}`, ...remainingSections].filter(Boolean).join("\n\n").trim();
}

export function buildBpConclusionSummary({ companyName, sources = [], sourceCount, analysis = {}, claimLedger = {}, investmentAnalysis = {} } = {}) {
  const ledger = claimLedger?.summary || {};
  const risks = array(analysis?.risks);
  const resolvedSourceCount = Number(sourceCount ?? sources.length ?? 0);
  const stance = {
    positive: "倾向推进，但仍需完成关键事实复核",
    conditional: "有条件推进，关键条件满足前不宜形成最终投资决策",
    negative: "不建议推进，需先排除关键风险",
    insufficient: "证据不足，暂不形成确定性投资判断"
  }[investmentAnalysis?.decision?.stance] || "证据不足，暂不形成确定性投资判断";
  const totalClaims = Number(ledger.total || array(analysis?.claims).length || 0);
  const supported = Number(ledger.supported || 0);
  const conflicted = Number(ledger.conflicted || 0);
  const open = Number(ledger.highPriorityOpen || 0);
  const riskSummary = risks.slice(0, 3).map((risk) => inlineText(risk?.description || risk?.basis || risk?.category)).filter(Boolean).join("；");
  return [
    `- **总体判断**：${companyName ? `对${inlineText(companyName)}的当前判断为` : "当前判断为"}${stance}。`,
    `- **核查范围**：已整理 ${totalClaims} 条关键声明，并纳入 ${resolvedSourceCount} 个公开来源进行交叉核验。`,
    `- **证据状态**：${supported} 条声明获得公开支持，${conflicted} 条存在证据冲突，${open} 条高优先级声明仍待核实。`,
    `- **主要风险**：${riskSummary || "现有材料尚不足以排除客户、财务、技术、合规及融资信息风险。"}`,
    "- **下一步**：优先索取关键声明的原始底稿和第三方证据，并通过客户、财务、技术及团队访谈完成闭环验证。"
  ].join("\n");
}

export function buildCompanyResearchConclusionSummary({ companyName, sources = [], sourceCount, analysis = {} } = {}) {
  const findings = array(analysis?.findings);
  const risks = array(analysis?.risks);
  const missing = array(analysis?.missingInformation);
  const resolvedSourceCount = Number(sourceCount ?? sources.length ?? 0);
  const riskSummary = risks.slice(0, 3).map((risk) => inlineText(risk?.description || risk?.category)).filter(Boolean).join("；");
  return [
    `- **总体判断**：已完成${companyName ? `${companyName}的` : "该公司的"}公开信息初步检索，当前结论仅用于投资预研，不替代正式尽调。`,
    `- **证据范围**：共纳入 ${resolvedSourceCount} 个公开来源，形成 ${findings.length} 条结构化发现。`,
    `- **主要风险**：${riskSummary || "公开资料不足以排除主体、客户、财务、技术及合规风险。"}`,
    `- **信息缺口**：${missing.slice(0, 3).map(inlineText).filter(Boolean).join("；") || "关键商业数据和公司底稿仍需进一步取得。"}`,
    "- **下一步**：核实法定主体、核心团队、客户合同、财务数据、知识产权和历史融资，并对关键来源进行交叉验证。"
  ].join("\n");
}

export function normalizeReviewReport(review, markdown = review?.report) {
  const text = String(markdown || "").trim();
  if (text && !/^#[ \t]+/m.test(text)) return text;
  if (review?.outputLanguage === "en") return text;
  const taskType = review?.taskType || "attachment_review";
  if (["industry_research", "paper_analysis"].includes(taskType)) return text;
  if (taskType === "company_pre_research") {
    return ensureLeadingSummary(text, {
      heading: COMPANY_SUMMARY_HEADING,
      aliases: ["公司预研结论摘要", "结论摘要"],
      fallback: buildCompanyResearchConclusionSummary(review)
    });
  }
  return ensureLeadingSummary(text, {
    heading: BP_SUMMARY_HEADING,
    aliases: ["内容核查结论摘要", "BP 核查结论摘要", "结论摘要"],
    fallback: buildBpConclusionSummary(review)
  });
}

function parseSecondLevelSections(text) {
  const headings = Array.from(text.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm));
  return headings.map((match, index) => {
    const start = match.index;
    const end = headings[index + 1]?.index ?? text.length;
    const headingEnd = start + match[0].length;
    return { heading: match[1], start, body: text.slice(headingEnd, end).trim(), raw: text.slice(start, end) };
  });
}

function insertAfterTitle(text, heading, body) {
  const title = text.match(/^#[ \t]+[^\n]*(?:\n|$)/);
  if (!title) return [`## ${heading}\n\n${body}`, text].filter(Boolean).join("\n\n").trim();
  const titleText = title[0].trim();
  const remainder = text.slice(title[0].length).trim();
  return [titleText, `## ${heading}\n\n${body}`, remainder].filter(Boolean).join("\n\n").trim();
}

function hasMeaningfulSummary(value) {
  return String(value || "").replace(/[#>*_`|\-\s]/g, "").length >= 16;
}

function normalizeHeading(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function inlineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 260);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
