import { t } from "./i18n.js";
import { requestJson } from "./http-client.js";

const slot = document.querySelector("#googleAuthSlot");
const login = document.querySelector("#googleLoginButton");
const account = document.querySelector("#googleAccount");
const avatar = document.querySelector("#googleAccountAvatar");
const name = document.querySelector("#googleAccountName");
const logout = document.querySelector("#googleLogoutButton");
const secureLabel = document.querySelector("#secureLabelText");
const helpText = document.querySelector("#privacyHelpText");

void initialize();

async function initialize() {
  try {
    const session = await requestJson("/api/auth/session");
    if (!session.enabled) return;
    if (session.required && !session.authenticated) return globalThis.location.assign("/auth/google?returnTo=/");
    slot.classList.remove("hidden");
    if (session.authenticated && session.user) renderAccount(session.user);
    else login.classList.remove("hidden");
    login.addEventListener("click", () => globalThis.location.assign("/auth/google?returnTo=/"));
    logout.addEventListener("click", signOut);
    helpText.dataset.i18n = "auth.help";
    helpText.textContent = t("auth.help", { zh: "可选择 Google 登录以跨浏览器访问自己的研究记录；未登录时仍使用长期匿名浏览器 Cookie 隔离任务。" });
  } catch {
    slot.classList.add("hidden");
  }
}

function renderAccount(user) {
  account.classList.remove("hidden");
  login.classList.add("hidden");
  name.textContent = user.name || user.email;
  name.title = user.email;
  if (user.picture) {
    avatar.src = user.picture;
    avatar.alt = "";
    avatar.classList.remove("hidden");
  }
  secureLabel.dataset.i18n = "top.accountSecure";
  secureLabel.textContent = t("top.accountSecure", { zh: "Google 账户隔离" });
}

async function signOut() {
  logout.disabled = true;
  try {
    await requestJson("/auth/logout", { method: "POST" });
    globalThis.location.reload();
  } finally {
    logout.disabled = false;
  }
}
