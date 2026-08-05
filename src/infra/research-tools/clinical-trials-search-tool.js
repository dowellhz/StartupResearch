import { boundedQueries, clean, researchSource } from "./research-tool-source.js";

export function createClinicalTrialsSearchTool({ http, maxQueries = 2, maxResults = 4 } = {}) {
  if (!http) throw new Error("ClinicalTrials.gov HTTP dependency is required");
  return {
    name: "clinical_trials_search",
    async search(input = {}) {
      const sources = [];
      for (const query of boundedQueries({ ...input, maxQueries })) {
        const url = new URL("https://clinicaltrials.gov/api/v2/studies");
        url.searchParams.set("query.term", query);
        url.searchParams.set("pageSize", String(maxResults));
        url.searchParams.set("format", "json");
        const payload = await http.getJson(url, { signal: input.signal });
        for (const study of Array.isArray(payload?.studies) ? payload.studies : []) {
          const source = sourceFromStudy(study);
          if (source) sources.push(source);
        }
      }
      return sources;
    }
  };
}

function sourceFromStudy(study) {
  const protocol = study?.protocolSection || {};
  const identification = protocol.identificationModule || {};
  const status = protocol.statusModule || {};
  const sponsor = protocol.sponsorCollaboratorsModule || {};
  const design = protocol.designModule || {};
  const outcomes = protocol.outcomesModule || {};
  const nctId = clean(identification.nctId, 30);
  if (!/^NCT\d{8}$/i.test(nctId)) return null;
  const phases = arrayText(design.phases);
  const conditions = arrayText(protocol.conditionsModule?.conditions);
  const primaryOutcomes = (outcomes.primaryOutcomes || []).map((item) => clean(item?.measure, 180)).filter(Boolean).slice(0, 2).join("；");
  return researchSource({
    title: identification.briefTitle || identification.officialTitle || nctId,
    url: `https://clinicaltrials.gov/study/${nctId}`,
    publishedAt: status.studyFirstPostDateStruct?.date || status.studyFirstPostDate || status.lastUpdatePostDateStruct?.date || "",
    provider: "ClinicalTrials.gov",
    snippet: [
      `登记号 ${nctId}`,
      status.overallStatus ? `状态 ${status.overallStatus}` : "",
      phases ? `阶段 ${phases}` : "",
      sponsor.leadSponsor?.name ? `申办方 ${sponsor.leadSponsor.name}` : "",
      design.enrollmentInfo?.count ? `计划/实际入组 ${design.enrollmentInfo.count}` : "",
      conditions ? `适应症 ${conditions}` : "",
      primaryOutcomes ? `主要终点 ${primaryOutcomes}` : "",
      status.lastUpdatePostDateStruct?.date ? `最近更新 ${status.lastUpdatePostDateStruct.date}` : ""
    ].filter(Boolean).join("；")
  });
}

function arrayText(value) {
  return (Array.isArray(value) ? value : []).map((item) => clean(item, 120)).filter(Boolean).slice(0, 4).join("、");
}
