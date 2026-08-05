export async function expandLinkedPageSearch({
  linkedPageResearch,
  companyName,
  sources,
  claims,
  queries,
  signal,
  onToolCall,
  searchFallback
} = {}) {
  if (!linkedPageResearch?.expand || !sources.length) return { sources, expanded: false };
  const linkedTool = { name: "linked_page_research", label: "关联页面二级搜索" };
  onToolCall?.(linkedTool);
  try {
    const expansion = await linkedPageResearch.expand({
      companyName,
      sources,
      claims,
      queries,
      signal,
      onProgress: (message) => onToolCall?.({ ...linkedTool, label: message })
    });
    const expandedSources = [...sources, ...(expansion.sources || [])];
    if (expansion.fallbackQueries?.length) {
      const fallbackTool = { name: "general_web_search", label: "受限页面聚焦搜索", status: "fallback" };
      onToolCall?.(fallbackTool);
      try {
        expandedSources.push(...await searchFallback(expansion.fallbackQueries));
      } catch {
        onToolCall?.({ ...fallbackTool, status: "failed", label: `${fallbackTool.label}（接口不可用，已保留其他检索）` });
      }
    }
    return { sources: expandedSources, expanded: true, stats: expansion.stats };
  } catch (error) {
    if (signal?.aborted) throw error;
    onToolCall?.({ ...linkedTool, status: "failed", label: `${linkedTool.label}（页面不可用，已保留一级检索）` });
    return { sources, expanded: false, error: error.message || String(error) };
  }
}
