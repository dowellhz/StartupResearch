export function submitUploadedBp({ requestJson, companyName, instruction, outputLanguage, file, data }) {
  return requestJson("/api/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyName,
      instruction,
      outputLanguage,
      file: { filename: file.name, mimeType: file.type, size: file.size, data }
    })
  });
}

export function submitCompanyPreResearch({ requestJson, companyName, instruction, outputLanguage }) {
  return requestJson("/api/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskType: "company_pre_research", companyName, instruction, outputLanguage })
  });
}

export function submitIndustryResearch({ requestJson, topic, instruction, researchTemplate, outputLanguage }) {
  return requestJson("/api/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskType: "industry_research", companyName: topic, instruction, researchTemplate, outputLanguage })
  });
}

export function submitPaperAnalysis({ requestJson, title, instruction, sourceUrl, outputLanguage, file, data }) {
  return requestJson("/api/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskType: "paper_analysis",
      companyName: title,
      instruction,
      sourceUrl,
      outputLanguage,
      ...(file ? { file: { filename: file.name, mimeType: file.type, size: file.size, data } } : {})
    })
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
