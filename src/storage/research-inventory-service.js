import path from "node:path";

const SOURCE_LABELS = {
  current: "当前任务",
  deleted: "已删除归档",
  retention: "保留期回收区"
};

const TASK_LABELS = {
  attachment_review: "BP 核查",
  company_pre_research: "公司预研",
  industry_research: "行业研究",
  paper_analysis: "论文解读"
};

const TEMPLATE_LABELS = {
  industry_overview: "行业概览",
  technical: "技术研究",
  commercial: "商业前景",
  investment: "投资价值"
};

const STATUS_LABELS = {
  completed: "已完成",
  needs_attention: "需要关注",
  failed: "失败",
  queued: "排队中",
  running: "进行中",
  cancelled: "已取消"
};

export async function collectResearchInventory({ dataDir, fs, includeArchived = true } = {}) {
  if (!dataDir || !fs?.readdir || !fs?.readFile || !fs?.stat) throw new Error("research inventory requires dataDir and filesystem dependencies");
  const sources = [
    { key: "current", directory: path.join(dataDir, "jobs"), accepts: (file, root) => path.dirname(file) === root && file.endsWith(".json") && path.basename(file) !== "job-index.json" },
    ...(includeArchived ? [
      { key: "deleted", directory: path.join(dataDir, "deleted-conversations"), accepts: (file, root) => file.endsWith(".json") && path.relative(root, file).split(path.sep).length === 2 },
      { key: "retention", directory: path.join(dataDir, "retention-trash"), accepts: (file) => path.basename(file) === "job.json" }
    ] : [])
  ];
  const records = [];
  const warnings = [];
  for (const source of sources) {
    for (const file of await walk(source.directory, fs)) {
      if (!source.accepts(file, source.directory)) continue;
      try {
        const job = JSON.parse(await fs.readFile(file, "utf8"));
        if (!job?.id) continue;
        const metadata = await fs.stat(file);
        records.push(toInventoryRecord(job, source.key, metadata.mtime?.toISOString?.() || ""));
      } catch (error) {
        warnings.push({ source: source.key, file: path.relative(dataDir, file), error: String(error?.message || error) });
      }
    }
  }
  records.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  return { records, warnings };
}

export function formatResearchInventory({ records = [], warnings = [] } = {}, { format = "markdown", timeZone = "Asia/Shanghai" } = {}) {
  if (format === "json") return `${JSON.stringify({ count: records.length, records, warnings }, null, 2)}\n`;
  if (format !== "markdown") throw new Error("format must be markdown or json");
  const counts = countBy(records, (record) => record.taskType);
  const sourceCounts = countBy(records, (record) => record.source);
  const statusCounts = countBy(records, (record) => record.status);
  const lines = [
    "# VentureLens 服务器研究记录",
    "",
    `共 ${records.length} 项：${Object.entries(counts).map(([type, count]) => `${TASK_LABELS[type] || type} ${count}`).join("，") || "无任务"}。`,
    `存储位置：${Object.entries(sourceCounts).map(([source, count]) => `${SOURCE_LABELS[source] || source} ${count}`).join("，") || "无任务"}。`,
    `状态：${Object.entries(statusCounts).map(([status, count]) => `${STATUS_LABELS[status] || status} ${count}`).join("，") || "无任务"}。`,
    ""
  ];
  let date = "";
  records.forEach((record, index) => {
    const parts = dateParts(record.createdAt, timeZone);
    if (parts.date !== date) {
      if (date) lines.push("");
      date = parts.date;
      lines.push(`## ${date}`, "");
    }
    const template = record.researchTemplate ? ` · ${TEMPLATE_LABELS[record.researchTemplate] || record.researchTemplate}` : "";
    const archive = record.source === "current" ? "" : ` · ${SOURCE_LABELS[record.source] || record.source}`;
    const refresh = record.refreshStatus ? ` · 资料刷新：${record.refreshStatus}` : "";
    lines.push(`${index + 1}. ${parts.time}｜${TASK_LABELS[record.taskType] || record.taskType}${template}｜${record.topic}｜${record.status}${archive}${refresh}`);
    if (record.instruction) lines.push(`   - 要求：${record.instruction}`);
  });
  if (warnings.length) lines.push("", `> 有 ${warnings.length} 个文件无法解析；JSON 输出包含具体路径和错误。`);
  return `${lines.join("\n")}\n`;
}

function toInventoryRecord(job, source, fallbackTime) {
  return {
    id: String(job.id),
    source,
    taskType: inferTaskType(job),
    topic: compact(job.companyName || job.title || "未命名主题", 160),
    instruction: compact(job.instruction, 240),
    researchTemplate: String(job.researchTemplate || ""),
    outputLanguage: String(job.outputLanguage || "zh"),
    status: String(job.status || "unknown"),
    refreshStatus: String(job.evidenceRefresh?.status || ""),
    createdAt: validDate(job.createdAt) || validDate(fallbackTime) || "1970-01-01T00:00:00.000Z",
    updatedAt: validDate(job.updatedAt) || "",
    completedAt: validDate(job.completedAt) || ""
  };
}

function inferTaskType(job) {
  if (TASK_LABELS[job.taskType]) return job.taskType;
  if (String(job.id).startsWith("research_")) return "company_pre_research";
  if (String(job.id).startsWith("industry_")) return "industry_research";
  if (String(job.id).startsWith("paper_")) return "paper_analysis";
  return "attachment_review";
}

async function walk(directory, fs) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const values = await Promise.all(entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(target, fs) : [target];
    }));
    return values.flat();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function dateParts(value, timeZone) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

function validDate(value) {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  return new Date(value).toISOString();
}

function compact(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function countBy(values, select) {
  return values.reduce((counts, value) => ({ ...counts, [select(value)]: (counts[select(value)] || 0) + 1 }), {});
}
