import { LANGUAGE_EN, getLanguage, t } from "./i18n.js";
import { stageStatusCopy } from "./review-request-message.js";

export function progressStageCopy(stage) {
  const english = getLanguage() === LANGUAGE_EN;
  return {
    label: english ? titleCase(stage.key) : stage.label,
    message: english ? stageStatusCopy(stage.status) : stage.message || stageStatusCopy(stage.status),
    time: stage.status === "running"
      ? t("progress.processing", { zh: "处理中" })
      : ["completed", "restored"].includes(stage.status) ? t("progress.done", { zh: "完成" }) : ""
  };
}

function titleCase(value) {
  return String(value || "stage").split("-").map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}
