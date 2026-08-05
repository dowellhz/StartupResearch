import { Result } from "../../domain/result.js";
import { createArxivPaperSearchTool } from "./arxiv-paper-search-tool.js";
import { createClinicalTrialsSearchTool } from "./clinical-trials-search-tool.js";
import { createGitHubRepositorySearchTool, createHuggingFaceAssetSearchTool } from "./open-source-footprint-tools.js";
import { createOpenAlexResearchTool } from "./openalex-research-tool.js";
import { createProcurementNoticeSearchTool } from "./procurement-notice-search-tool.js";
import { createResearchToolHttpClient } from "./research-tool-http-client.js";
import { createScholarlyWorksSearchTool } from "./scholarly-works-search-tool.js";
import { createSecFilingSearchTool } from "./sec-filing-search-tool.js";
import { createSoftwareVulnerabilitySearchTool } from "./software-vulnerability-search-tool.js";

export function createStructuredResearchToolService({ fetchImpl = globalThis.fetch, timeoutMs = 8000, maxAttempts = 2, credentials = {}, tools } = {}) {
  const http = createResearchToolHttpClient({ fetchImpl, timeoutMs, maxAttempts });
  const values = tools || [
    createClinicalTrialsSearchTool({ http }),
    createArxivPaperSearchTool({ http }),
    createScholarlyWorksSearchTool({ http }),
    credentials.openAlexApiKey ? createOpenAlexResearchTool({ http, apiKey: credentials.openAlexApiKey }) : null,
    createGitHubRepositorySearchTool({ http }),
    createHuggingFaceAssetSearchTool({ http }),
    createSoftwareVulnerabilitySearchTool({ http }),
    createSecFilingSearchTool({ http }),
    createProcurementNoticeSearchTool({ http })
  ].filter(Boolean);
  const byName = new Map(values.map((tool) => [tool.name, tool]));

  return {
    names() {
      return Array.from(byName.keys());
    },
    zeroKeyNames() {
      return values.filter((tool) => tool.requiresKey !== true).map((tool) => tool.name);
    },
    keyedStatus() {
      return { openalex_research_search: byName.has("openalex_research_search") };
    },
    has(name) {
      return byName.has(name);
    },
    async run(name, input = {}) {
      const tool = byName.get(name);
      if (!tool) return Result.fail(`unsupported structured research tool: ${name}`, { tool: name });
      try {
        return Result.ok(await tool.search(input));
      } catch (error) {
        return Result.fail(error, { tool: name });
      }
    }
  };
}
