import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile, getRuntimeConfig } from "../src/config/runtime-config.js";
import { createPdfReportService } from "../src/infra/pdf-report-service.js";
import { createFileReviewRepository } from "../src/storage/file-review-repository.js";
import { redactSensitiveText, sanitizeVisibleFilename } from "../public/privacy-redaction.js";

loadEnvFile();
const config = getRuntimeConfig();
const repository = createFileReviewRepository({ dataDir: config.dataDir });
const pdf = createPdfReportService();
const jobsDir = path.join(config.dataDir, "jobs");
let updated = 0;

for (const name of await readdir(jobsDir)) {
  if (!name.endsWith(".json")) continue;
  const target = path.join(jobsDir, name);
  const original = JSON.parse(await readFile(target, "utf8"));
  let job = redactDeep(original);
  if (original.upload?.filename) job.upload.filename = sanitizeVisibleFilename(original.upload.filename);
  const report = redactSensitiveText(await repository.getReport(job.id));
  if (report) {
    await repository.saveReport(job.id, report);
    const buffer = await pdf.render({ title: `${job.companyName || "未命名公司"} BP 核查报告`, markdown: report });
    job.pdfStoragePath = await repository.savePdf(job.id, buffer, { date: job.createdAt || job.completedAt });
  }
  await repository.save(job);
  updated += 1;
}

process.stdout.write(`Redacted ${updated} active review records\n`);

function redactDeep(value) {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item)]));
}
