export function submitUploadedBp({ requestJson, currentId, currentReview, companyName, instruction, file, data }) {
  const shouldMatch = Boolean(currentId && currentReview?.reportAvailable && currentReview.taskType !== "company_pre_research");
  const url = shouldMatch ? `/api/reviews/${currentId}/company-match` : "/api/reviews";
  return requestJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(shouldMatch ? { apply: true } : {}),
      companyName,
      instruction,
      file: { filename: file.name, mimeType: file.type, size: file.size, data }
    })
  });
}

export function submitCompanyPreResearch({ requestJson, companyName, instruction }) {
  return requestJson("/api/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskType: "company_pre_research", companyName, instruction })
  });
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

export function applyUploadRouting(payload, { elements, state, notify }) {
  if (payload.action === "created_new") {
    elements.messageStream.innerHTML = "";
    state.autoFollow = true;
    notify(`识别为不同公司，已新建对话：${payload.decision.newCompanyName || "待识别公司"}`);
  } else if (payload.action === "reanalyze_current") {
    notify("AI 判断为同一公司，正在当前对话核查新版 BP");
  }
}
