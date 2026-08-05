import { boundedQueries, clean, researchSource } from "./research-tool-source.js";

export function createGitHubRepositorySearchTool({ http, maxQueries = 2, maxResults = 4 } = {}) {
  if (!http) throw new Error("GitHub HTTP dependency is required");
  return {
    name: "github_repository_search",
    async search(input = {}) {
      const sources = [];
      for (const query of boundedQueries({ ...input, maxQueries })) {
        const url = new URL("https://api.github.com/search/repositories");
        url.searchParams.set("q", `${query} in:name,description,readme`);
        url.searchParams.set("per_page", String(maxResults));
        const payload = await http.getJson(url, {
          signal: input.signal,
          headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }
        });
        for (const item of Array.isArray(payload?.items) ? payload.items : []) {
          const source = githubSource(item);
          if (source) sources.push(source);
        }
      }
      return sources;
    }
  };
}

export function createHuggingFaceAssetSearchTool({ http, maxQueries = 2, maxResults = 4 } = {}) {
  if (!http) throw new Error("Hugging Face HTTP dependency is required");
  return {
    name: "huggingface_asset_search",
    async search(input = {}) {
      const sources = [];
      for (const query of boundedQueries({ ...input, maxQueries })) {
        const url = new URL("https://huggingface.co/api/models");
        url.searchParams.set("search", query);
        url.searchParams.set("limit", String(maxResults));
        url.searchParams.set("full", "false");
        const payload = await http.getJson(url, { signal: input.signal });
        for (const item of Array.isArray(payload) ? payload : []) {
          const source = huggingFaceSource(item);
          if (source) sources.push(source);
        }
      }
      return sources;
    }
  };
}

function githubSource(item) {
  if (!item?.html_url || !item?.full_name) return null;
  return researchSource({
    title: item.full_name,
    url: item.html_url,
    publishedAt: item.updated_at || item.pushed_at || "",
    sourceTier: "secondary",
    provider: "GitHub",
    snippet: [
      clean(item.description, 500),
      item.language ? `主要语言 ${item.language}` : "",
      Number.isFinite(item.stargazers_count) ? `Stars ${item.stargazers_count}` : "",
      Number.isFinite(item.forks_count) ? `Forks ${item.forks_count}` : "",
      item.updated_at ? `最近更新 ${item.updated_at}` : "",
      item.archived ? "仓库已归档" : ""
    ].filter(Boolean).join("；")
  });
}

function huggingFaceSource(item) {
  const id = clean(item?.modelId || item?.id, 300);
  if (!id) return null;
  return researchSource({
    title: id,
    url: `https://huggingface.co/${id}`,
    publishedAt: item.lastModified || item.createdAt || "",
    sourceTier: "secondary",
    provider: "Hugging Face",
    snippet: [
      item.pipeline_tag ? `任务 ${item.pipeline_tag}` : "",
      item.library_name ? `框架 ${item.library_name}` : "",
      Number.isFinite(item.downloads) ? `近期开源下载 ${item.downloads}` : "",
      Number.isFinite(item.likes) ? `Likes ${item.likes}` : "",
      item.private ? "私有资产" : "公开资产",
      item.lastModified ? `最近更新 ${item.lastModified}` : ""
    ].filter(Boolean).join("；")
  });
}
