import path from "node:path";
import { createFileReviewRepository } from "../src/storage/file-review-repository.js";

const args = new Map(process.argv.slice(2).map((value, index, values) => value.startsWith("--") ? [value, values[index + 1]?.startsWith("--") ? "" : values[index + 1]] : ["", ""]));
const ownerId = String(args.get("--owner-id") || "").trim();
const dataDir = path.resolve(args.get("--data-dir") || "data");
const dryRun = process.argv.includes("--dry-run");

if (!ownerId || !/^(?:anon|google)_[a-zA-Z0-9_-]{20,100}$/.test(ownerId)) {
  throw new Error("用法：node scripts/migrate-legacy-owners.mjs --owner-id <anon_...|google_...> [--data-dir data] [--dry-run]");
}

const repository = createFileReviewRepository({ dataDir });
await repository.initialize();
const unowned = (await repository.listSummaries({ limit: 100000 })).filter((job) => !job.ownerId);
if (dryRun) {
  process.stdout.write(`将把 ${unowned.length} 个无主任务迁移给 ${ownerId}\n`);
} else {
  const migrated = await repository.assignUnowned(ownerId);
  process.stdout.write(`已把 ${migrated} 个无主任务迁移给 ${ownerId}\n`);
}
