import { completeStructuredJson } from "./structured-model-call.js";

export function createSemanticOverclaimService({ model, enabled = true } = {}) {
  async function check({ report, claimLedger, evidenceManifest, signal } = {}) {
    if (!enabled) return { checked: false, ok: true, findings: [], warning: "" };
    const sourceIds = new Set((evidenceManifest?.citations || []).map((item) => String(item.sourceId || "")).filter(Boolean));
    try {
      const value = await completeStructuredJson({
        model,
        signal,
        maxTokens: 1600,
        messages: buildMessages({ report, claimLedger, evidenceManifest }),
        validate: (raw) => normalizeResult(raw, sourceIds)
      });
      return { checked: true, ok: value.findings.length === 0, findings: value.findings, warning: "" };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { checked: false, ok: true, findings: [], warning: "语义级过度声称检查未完成；确定性质量门结果仍已保留" };
    }
  }

  return { check };
}

function buildMessages({ report, claimLedger, evidenceManifest }) {
  return [{
    role: "system",
    content: [
      "你是独立的投资报告证据边界审校器，只输出合法 JSON。",
      "检查报告是否把未披露写成不存在、把搜索缺失写成否定事实、把相关性写成因果、把单一来源写成已证实，或使用没有直接证据支持的欺诈/确定性定性。",
      "不要评价文风，不要重复确定性正则检查。只有能指出报告中的具体原句和证据缺口时才输出问题。",
      "输出 {findings:[{statement,reason,severity,sourceIds}]}；severity 只能是 high 或 medium；sourceIds 只能引用输入证据 ID。"
    ].join("\n")
  }, {
    role: "user",
    content: JSON.stringify({
      report: String(report || "").slice(0, 18000),
      claimLedger: Array.isArray(claimLedger?.claims) ? claimLedger.claims.slice(0, 30) : [],
      evidenceSummary: evidenceManifest?.summary || {},
      citations: Array.isArray(evidenceManifest?.citations) ? evidenceManifest.citations.slice(0, 50) : []
    })
  }];
}

function normalizeResult(value, sourceIds) {
  const findings = Array.isArray(value?.findings) ? value.findings : [];
  return {
    findings: findings.map((item) => ({
      statement: text(item?.statement, 500),
      reason: text(item?.reason, 800),
      severity: item?.severity === "high" ? "high" : "medium",
      sourceIds: Array.isArray(item?.sourceIds) ? item.sourceIds.map(String).filter((id) => sourceIds.has(id)).slice(0, 10) : []
    })).filter((item) => item.statement && item.reason).slice(0, 12)
  };
}

function text(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}
