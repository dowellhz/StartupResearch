import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { collectResearchInventory, formatResearchInventory } from "../src/storage/research-inventory-service.js";

test("research inventory includes current and archived jobs in chronological order without owners", async () => {
  const dataDir = path.resolve("/virtual/data");
  const files = new Map([
    [path.join(dataDir, "jobs", "industry_new.json"), JSON.stringify({ id: "industry_new", ownerId: "google_secret", taskType: "industry_research", companyName: "机器人", instruction: "研究商业前景", researchTemplate: "commercial", status: "completed", createdAt: "2026-08-14T02:00:00.000Z" })],
    [path.join(dataDir, "deleted-conversations", "20260813", "research_old.1.json"), JSON.stringify({ id: "research_old", companyName: "旧公司", status: "failed", createdAt: "2026-08-13T01:00:00.000Z" })],
    [path.join(dataDir, "deleted-conversations", "20260813", "research_old.1.artifacts", "pipeline.json"), JSON.stringify({ id: "not_a_job" })]
  ]);
  const inventory = await collectResearchInventory({ dataDir, fs: mockFs(files) });
  assert.deepEqual(inventory.records.map((item) => item.id), ["research_old", "industry_new"]);
  assert.equal(inventory.records[0].taskType, "company_pre_research");
  assert.equal("ownerId" in inventory.records[1], false);
});

test("research inventory renders Beijing-time Markdown and machine-readable JSON", () => {
  const inventory = { records: [{ id: "paper_1", source: "current", taskType: "paper_analysis", topic: "AI 论文", instruction: "检查方法", researchTemplate: "", outputLanguage: "zh", status: "completed", refreshStatus: "", createdAt: "2026-08-14T16:30:00.000Z", updatedAt: "", completedAt: "" }], warnings: [] };
  const markdown = formatResearchInventory(inventory);
  assert.match(markdown, /2026-08-15/);
  assert.match(markdown, /00:30｜论文解读｜AI 论文｜completed/);
  assert.match(markdown, /存储位置：当前任务 1/);
  assert.match(markdown, /状态：已完成 1/);
  assert.equal(JSON.parse(formatResearchInventory(inventory, { format: "json" })).count, 1);
});

function mockFs(files) {
  const directories = new Set();
  for (const file of files.keys()) {
    let current = path.dirname(file);
    while (current !== path.dirname(current)) {
      directories.add(current);
      current = path.dirname(current);
    }
  }
  return {
    readFile: async (file) => files.get(file),
    stat: async () => ({ mtime: new Date("2026-08-15T00:00:00.000Z") }),
    readdir: async (directory) => {
      if (!directories.has(directory)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      const names = new Set();
      for (const candidate of [...files.keys(), ...directories]) {
        if (path.dirname(candidate) === directory) names.add(path.basename(candidate));
      }
      return [...names].map((name) => ({ name, isDirectory: () => directories.has(path.join(directory, name)) }));
    }
  };
}
