const STORAGE_KEY = "venture-lens:composer-draft";
const STORAGE_VERSION = 2;

export function createComposerDraftController({ companyInput, promptInput, onRestore = () => {} }) {
  let explicitCompanyName = "";

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: STORAGE_VERSION,
        companyExplicit: Boolean(explicitCompanyName),
        companyName: explicitCompanyName,
        prompt: promptInput.value
      }));
    } catch {}
  }

  function saveCompany() {
    explicitCompanyName = String(companyInput.value || "").trim();
    save();
  }

  function restore() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      explicitCompanyName = value.version === STORAGE_VERSION && value.companyExplicit === true
        ? String(value.companyName || "")
        : "";
      companyInput.value = explicitCompanyName;
      promptInput.value = String(value.prompt || "");
      onRestore();
    } catch {}
  }

  function clear() {
    explicitCompanyName = "";
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  function clearPrompt() {
    promptInput.value = "";
    save();
    onRestore();
  }

  function clearCompany() {
    explicitCompanyName = "";
    save();
  }

  return { clear, clearCompany, clearPrompt, restore, save, saveCompany };
}

export function lastUserInput(review) {
  return [...(review.messages || [])].reverse().find((message) => message.role === "user")?.content || "";
}
