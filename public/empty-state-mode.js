import { LANGUAGE_EN, getLanguage } from "./i18n.js";

const ZH_CONTENT = Object.freeze({
  attachment_review: mode({
    eyebrow: "BP DUE DILIGENCE COPILOT",
    heading: "把商业计划书交给我，<br><em>从声明到证据逐项核查。</em>",
    copy: "上传 BP 即可开始，公司名称可选填。系统会从材料中识别公司，梳理商业逻辑、核查公开信息、标记风险，并生成可下载的投资研究报告。",
    suggestions: [
      ["重点核查团队履历、客户真实性和收入数据", "团队、客户与收入"],
      ["重点核查市场规模测算、竞争格局和产品壁垒", "市场与竞争壁垒"],
      ["站在 A 轮投资人角度，全面核查这份 BP", "A 轮投资视角"]
    ]
  }),
  company_pre_research: mode({
    eyebrow: "COMPANY RESEARCH COPILOT",
    heading: "把公司名称交给我，<br><em>从公开信息形成预研判断。</em>",
    copy: "无需上传附件。系统会检索公司、团队、产品、融资、客户与竞争信息，区分公开事实、来源观点和待核验事项。",
    suggestions: [
      ["重点研究创始团队、股权和历史履历", "团队与股权"],
      ["重点研究产品、客户、收入和融资情况", "业务与融资"],
      ["重点研究竞争对手、差异化和潜在风险", "竞争与风险"]
    ]
  }),
  industry_research: mode({
    eyebrow: "INDUSTRY RESEARCH COPILOT",
    heading: "把行业主题交给我，<br><em>从技术演进到投资机会系统研究。</em>",
    copy: "选择行业概览、技术研究、商业前景或投资价值。系统会规划研究问题，检索公开资料与论文，并形成带来源的行业判断。",
    suggestions: [
      ["重点研究主要技术路线、代表论文和成熟度", "技术路线与成熟度"],
      ["重点研究市场空间、产业链结构和竞争格局", "市场与产业链"],
      ["重点研究价值捕获环节、催化剂和风险", "投资机会与风险"]
    ]
  }),
  technology_research: mode({
    eyebrow: "TECHNOLOGY RESEARCH COPILOT",
    heading: "把技术主题交给我，<br><em>从核心原理到验证路线系统拆解。</em>",
    copy: "系统会调用网页、论文和专项数据库，比较主要技术路线、代表性证据、成熟度、工程瓶颈与商业化距离，并给出可执行的验证方案。",
    suggestions: [
      ["重点比较核心原理、主要技术路线和性能边界", "原理与技术路线"],
      ["重点检索代表论文、原型系统、开源资源和研究团队", "论文与原型"],
      ["重点评估成熟度、工程瓶颈并设计验证实验", "成熟度与验证" ]
    ]
  }),
  paper_analysis: mode({
    eyebrow: "PAPER ANALYSIS COPILOT",
    heading: "把论文交给我，<br><em>从技术实现到商业化距离逐层解读。</em>",
    copy: "上传论文 PDF 或填写公开论文 URL。系统会解析正文与页码，补充 arXiv、Crossref、OpenAlex 等学术资料并生成技术解读。",
    suggestions: [
      ["重点解释方法架构、核心算法和训练或推理流程", "技术架构与算法"],
      ["重点检查实验设计、基线、局限和复现难点", "实验可信度与复现"],
      ["重点判断行业价值、受益方和商业化距离", "行业价值与商业化"]
    ]
  })
});

const EN_CONTENT = Object.freeze({
  attachment_review: mode({ eyebrow: "BP DUE DILIGENCE COPILOT", heading: "Give me the business plan,<br><em>and I’ll verify every claim against evidence.</em>", copy: "Upload a BP to begin; the company name is optional. The system identifies the company, maps the business logic, verifies public information, flags risks and produces a downloadable investment report.", suggestions: [["Focus on team backgrounds, customer authenticity and revenue data", "Team, customers & revenue"], ["Focus on market sizing, competition and product defensibility", "Market & defensibility"], ["Review this BP comprehensively from a Series A investor perspective", "Series A perspective"]] }),
  company_pre_research: mode({ eyebrow: "COMPANY RESEARCH COPILOT", heading: "Give me a company name,<br><em>and I’ll build a view from public evidence.</em>", copy: "No attachment is required. The system researches the company, team, product, financing, customers and competition while separating public facts, source claims and open questions.", suggestions: [["Focus on founders, ownership and career history", "Team & ownership"], ["Focus on products, customers, revenue and financing", "Business & financing"], ["Focus on competitors, differentiation and potential risks", "Competition & risk"]] }),
  industry_research: mode({ eyebrow: "INDUSTRY RESEARCH COPILOT", heading: "Give me an industry topic,<br><em>and I’ll connect technology trends to investment opportunities.</em>", copy: "Choose an industry overview, technology research, commercial outlook or investment value template. The system plans questions, searches public sources and papers, and builds a source-backed view.", suggestions: [["Focus on technical approaches, representative papers and maturity", "Technology & maturity"], ["Focus on market size, value chain and competitive landscape", "Market & value chain"], ["Focus on value capture, catalysts and risks", "Opportunity & risk"]] }),
  technology_research: mode({ eyebrow: "TECHNOLOGY RESEARCH COPILOT", heading: "Give me a technology topic,<br><em>and I’ll map principles to an executable validation plan.</em>", copy: "The system calls web, paper and specialist tools to compare technical approaches, representative evidence, maturity, engineering constraints and commercialization distance.", suggestions: [["Compare core principles, major technical approaches and performance limits", "Principles & approaches"], ["Find representative papers, prototypes, open resources and research teams", "Papers & prototypes"], ["Assess maturity and engineering bottlenecks, then design validation experiments", "Maturity & validation"]] }),
  paper_analysis: mode({ eyebrow: "PAPER ANALYSIS COPILOT", heading: "Give me a paper,<br><em>and I’ll unpack its implementation and path to commercialization.</em>", copy: "Upload a paper PDF or enter a public paper URL. The system parses the text and page references, then enriches it with arXiv, Crossref and OpenAlex research.", suggestions: [["Explain the architecture, core algorithms and training or inference flow", "Architecture & algorithms"], ["Assess experiment design, baselines, limitations and reproducibility", "Evidence & reproducibility"], ["Assess industry value, beneficiaries and distance to commercialization", "Industry & commercialization"]] })
});

export function renderEmptyStateMode(elements, taskType) {
  const content = getLanguage() === LANGUAGE_EN ? EN_CONTENT : ZH_CONTENT;
  const selected = content[taskType] || content.attachment_review;
  elements.emptyEyebrow.textContent = selected.eyebrow;
  elements.emptyHeading.innerHTML = selected.heading;
  elements.emptyCopy.textContent = selected.copy;
  const buttons = Array.from(elements.emptySuggestions.querySelectorAll("button"));
  buttons.forEach((button, index) => {
    const suggestion = selected.suggestions[index];
    button.classList.toggle("hidden", !suggestion);
    if (!suggestion) return;
    button.dataset.suggestion = suggestion[0];
    button.querySelector("span").textContent = String(index + 1).padStart(2, "0");
    button.lastChild.textContent = suggestion[1];
  });
}

function mode(value) {
  return Object.freeze({ ...value, suggestions: Object.freeze(value.suggestions.map((item) => Object.freeze(item))) });
}
