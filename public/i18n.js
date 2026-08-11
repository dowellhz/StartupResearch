export const LANGUAGE_ZH = "zh";
export const LANGUAGE_EN = "en";

const STORAGE_KEY = "venture_lens_language";
const EN = Object.freeze({
  "document.title": "VentureLens · Investment Research",
  "brand.subtitle": "Investment Research Workspace",
  "sidebar.tasks": "New research task",
  "sidebar.newBp": "New BP Review",
  "sidebar.industry": "Industry Research",
  "sidebar.industrySub": "Public sources & papers",
  "sidebar.technology": "Technology Research",
  "sidebar.technologySub": "Principles, routes & maturity",
  "sidebar.paper": "Paper Analysis",
  "sidebar.paperSub": "PDF or paper URL",
  "sidebar.recent": "RECENT RESEARCH",
  "sidebar.history": "Research history",
  "sidebar.help": "Research Guide",
  "sidebar.language": "Switch to Chinese",
  "health.checking": "Checking DeepSeek…",
  "health.connected": "{model} connected",
  "health.notConfigured": "DeepSeek not configured",
  "health.unavailable": "Service unavailable",
  "top.newBp": "New BP Review",
  "top.newCompany": "New Company Research",
  "top.newIndustry": "New Industry Research",
  "top.newTechnology": "New Technology Research",
  "top.newPaper": "New Paper Analysis",
  "top.menu": "Open menu",
  "top.download": "Download full conversation PDF",
  "top.secure": "Anonymous browser isolation",
  "top.accountSecure": "Google account isolation",
  "auth.signIn": "Sign in with Google",
  "auth.signOut": "Sign out",
  "auth.help": "Optionally sign in with Google to access your research across browsers. Without sign-in, a persistent anonymous browser cookie continues to isolate your tasks.",
  "preview.company": "Company Research",
  "preview.companySub": "No attachment; research public information",
  "preview.industry": "Industry Research",
  "preview.industrySub": "Public sources, papers, technology and investment",
  "preview.technology": "Technology Research",
  "preview.technologySub": "Papers, technical routes, maturity and validation",
  "preview.researchType": "Research type",
  "preview.overview": "Industry Overview",
  "preview.technical": "Technology Research",
  "preview.commercial": "Commercial Outlook",
  "preview.investment": "Investment Value",
  "preview.paper": "Paper Analysis",
  "preview.paperSub": "Upload a PDF or enter a public paper URL",
  "preview.paperUrl": "Paper URL",
  "preview.uploadPdf": "Upload PDF",
  "menu.add": "Add content",
  "menu.attachment": "Add Attachment",
  "menu.attachmentSub": "A BP to verify or other meeting material",
  "menu.company": "Company Research",
  "menu.companySub": "No attachment; research public information",
  "composer.companyPlaceholder": "Company name (optional; can be identified from the material)",
  "composer.promptPlaceholder": "Add review requirements, or follow up after the report is ready…",
  "composer.send": "Start research",
  "composer.note": "Use + to add an attachment or start company research; you can also drag material here · AI findings are for investment research only",
  "composer.followupPlaceholder": "Ask a follow-up, or use + to upload new material…",
  "composer.companyRequired": "Company name (required for company research)",
  "composer.companyFocus": "Add optional research priorities",
  "composer.companyNote": "Company Research: enter a company name to research public information; no attachment is required",
  "composer.industryRequired": "Industry or technology topic (required)",
  "composer.industryFocus": "Add scope, geography, time period or investment priorities (optional)",
  "composer.industryNote": "Industry Research: the system plans questions and searches public sources, papers and specialist databases",
  "composer.technologyRequired": "Technology topic or technology combination (required)",
  "composer.technologyFocus": "Add application scenarios, performance metrics, time range or validation priorities (optional)",
  "composer.technologyNote": "Technology Research: the system calls web, paper and specialist tools to analyze principles, routes, maturity and validation plans",
  "composer.paperTitle": "Paper title (optional; can be identified from the PDF)",
  "composer.paperFocus": "Add priorities such as technology, reproducibility or commercialization",
  "composer.paperNote": "Paper Analysis: upload a PDF or enter a public paper URL; the system enriches it with academic research",
  "help.title": "Review is not a BP summary",
  "help.p1": "The system treats BP content as claims to verify, separating public support, conflicts, BP-only claims, insufficient evidence and analytical inference. If online research fails, the best available draft is still retained with clear limitations.",
  "help.p2": "Start Industry Research or Paper Analysis from the left. Industry Research supports overview, technology, commercial and investment templates; Paper Analysis accepts a PDF or public paper URL.",
  "help.p3": "PDF, PPTX, DOCX, TXT and Markdown are supported, up to 20 MB by default.",
  "help.p4": "No sign-in is required. A persistent anonymous browser cookie isolates your tasks. Clearing cookies, using incognito mode or changing browsers creates a new anonymous user.",
  "confirm.title": "No attachment added",
  "confirm.description": "Research the company's public information without an attachment?",
  "confirm.back": "Back to add attachment",
  "confirm.start": "Start Company Research",
  "history.empty": "No research history",
  "history.unnamed": "Untitled research",
  "history.delete": "Delete conversation",
  "history.deleteTitle": "Delete conversation; retain attachment",
  "history.confirmDelete": "Delete this conversation?",
  "history.deleted": "Conversation deleted",
  "history.deletedRetained": "Conversation deleted; original attachment retained",
  "history.now": "just now",
  "history.minutes": "{count} min ago",
  "history.hours": "{count} hr ago",
  "history.days": "{count} days ago",
  "status.queued": "Queued",
  "status.completed": "Completed",
  "status.attention": "Needs attention",
  "status.failed": "Failed",
  "status.reviewing": "Reviewing",
  "status.company": "Researching company",
  "status.industry": "Researching industry",
  "status.technology": "Researching technology",
  "status.paper": "Analyzing paper",
  "task.attachment": "Attachment Review",
  "task.company": "Company Research",
  "task.industry": "Industry Research",
  "task.technology": "Technology Research",
  "task.paper": "Paper Analysis",
  "report.bp": "BP Review Report",
  "report.company": "Company Research Report",
  "report.industry": "Industry Research Report",
  "report.technology": "Technology Research Report",
  "report.paper": "Paper Analysis Report",
  "result.review": "Review Results",
  "result.company": "Company Research Results",
  "result.industry": "Industry Research Results",
  "result.technology": "Technology Research Results",
  "result.paper": "Paper Analysis Results",
  "rerun.review": "Run Review Again",
  "rerun.company": "Research Again",
  "rerun.industry": "Research Again",
  "rerun.technology": "Research Again",
  "rerun.paper": "Analyze Again",
  "validation.company": "Enter a company name for Company Research",
  "validation.industry": "Enter an industry or technology topic",
  "validation.technology": "Enter a technology topic",
  "validation.paperSource": "Upload a PDF or enter a paper URL",
  "validation.paperPdf": "Paper Analysis supports PDF files only",
  "instruction.company": "Research the company using public information",
  "instruction.industry": "Produce an industry overview",
  "instruction.technology": "Produce a technology research report",
  "instruction.paper": "Analyze the paper's technology, credibility, industry value and commercialization potential",
  "progress.agent": "Research Agent",
  "progress.running": "Research in progress",
  "progress.processing": "Processing",
  "progress.done": "Done",
  "progress.taskDone": "{task} complete",
  "progress.taskRunning": "{task} in progress",
  "report.refresh": "Refresh Public Sources",
  "report.download": "Download PDF report",
  "quality.score": "Quality {score}",
  "message.you": "You",
  "message.request": "Your request",
  "message.followup": "Your follow-up",
  "error.interrupted": "Research interrupted",
  "error.retained": "Completed stages and the best draft were retained; retry from history.",
  "validation.question": "Enter a question",
  "validation.oneFile": "Only one file can be uploaded at a time; the first file was selected",
  "validation.fileTypes": "Upload a PDF, PPTX, DOCX, TXT or Markdown file",
  "validation.fileSize": "The file must be 20 MB or smaller",
  "file.paperPending": "Ready for paper analysis",
  "file.companyPending": "The company will be identified and conversation routing decided after submission",
  "file.reviewPending": "Ready for review",
  "routing.newCompany": "New company identified. Switched to a new conversation: {company}",
  "routing.sameCompany": "Same company identified. Reviewing the additional material in this conversation",
  "instruction.bp": "Review this BP comprehensively",
  "instruction.material": "Review this material comprehensively",
  "error.taskFailed": "Research task failed",
  "composer.riskFollowup": "Ask a follow-up: what is the greatest investment risk?",
  "followup.running": "Follow-up analysis in progress",
  "followup.answer": "Research answer",
  "followup.completed": "Follow-up analysis complete",
  "followup.incomplete": "Follow-up analysis incomplete",
  "followup.failed": "Answer failed: {message}",
  "refresh.confirm": "Refresh public sources with up to 8 queries and generate a separate change report?",
  "refresh.started": "Public-source refresh started",
  "refresh.completed": "Public-source change report generated",
  "refresh.degraded": "Refresh completed with degraded sources",
  "refresh.failed": "Public-source refresh failed",
  "refresh.label": "Public Source Refresh",
  "refresh.running": "Refreshing public sources",
  "refresh.report": "Public-source change report",
  "refresh.empty": "No change report was produced by this refresh"
});

let currentLanguage = detectLanguage();

export function getLanguage() {
  return currentLanguage;
}

export function setLanguage(value, { persist = true } = {}) {
  currentLanguage = normalizeLanguage(value);
  if (persist) safeStorageSet(STORAGE_KEY, currentLanguage);
  if (typeof document !== "undefined") document.documentElement.lang = currentLanguage === LANGUAGE_EN ? "en" : "zh-CN";
  return currentLanguage;
}

export function t(key, variables = {}) {
  const base = currentLanguage === LANGUAGE_EN ? EN[key] : "";
  const value = base || variables.zh || key;
  return String(value).replace(/\{(\w+)\}/g, (_match, name) => variables[name] ?? `{${name}}`);
}

export function applyDocumentTranslations(root = document) {
  setLanguage(currentLanguage, { persist: false });
  root.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n, { zh: element.dataset.i18nZh || element.textContent }); });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => { element.placeholder = t(element.dataset.i18nPlaceholder, { zh: element.dataset.i18nZh || element.placeholder }); });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((element) => { element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel, { zh: element.dataset.i18nZh || element.getAttribute("aria-label") })); });
  root.querySelectorAll("[data-i18n-title]").forEach((element) => { element.title = t(element.dataset.i18nTitle, { zh: element.dataset.i18nZh || element.title }); });
  if (typeof document !== "undefined") document.title = t("document.title", { zh: "VentureLens · BP 核查" });
}

export function bindLanguageToggle({ button, reload = () => globalThis.location?.reload() }) {
  syncLanguageToggle(button);
  button.addEventListener("click", () => {
    setLanguage(currentLanguage === LANGUAGE_EN ? LANGUAGE_ZH : LANGUAGE_EN);
    reload();
  });
}

export function syncLanguageToggle(button) {
  button.textContent = currentLanguage === LANGUAGE_EN ? "中文" : "EN";
  button.setAttribute("aria-label", t("sidebar.language", { zh: "切换为英文" }));
  button.title = t("sidebar.language", { zh: "切换为英文" });
}

export function detectLanguage({ storage = safeStorageGet(STORAGE_KEY), browserLanguage = typeof window !== "undefined" ? globalThis.navigator?.language : "zh-CN" } = {}) {
  if (storage) return normalizeLanguage(storage);
  return /^zh\b/i.test(String(browserLanguage || "")) ? LANGUAGE_ZH : LANGUAGE_EN;
}

export function normalizeLanguage(value) {
  return String(value || "").toLowerCase().startsWith("en") ? LANGUAGE_EN : LANGUAGE_ZH;
}

function safeStorageGet(key) {
  if (typeof window === "undefined") return "";
  try { return globalThis.localStorage?.getItem(key) || ""; } catch { return ""; }
}

function safeStorageSet(key, value) {
  if (typeof window === "undefined") return;
  try { globalThis.localStorage?.setItem(key, value); } catch {}
}
