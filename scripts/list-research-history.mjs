import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { collectResearchInventory, formatResearchInventory } from "../src/storage/research-inventory-service.js";

const options = parseArgs(process.argv.slice(2));
const dataDir = path.resolve(options.get("--data-dir") || "data");
const format = options.get("--format") || "markdown";
const timeZone = options.get("--timezone") || "Asia/Shanghai";
const inventory = await collectResearchInventory({
  dataDir,
  fs: { readdir, readFile, stat },
  includeArchived: !options.has("--current-only")
});
process.stdout.write(formatResearchInventory(inventory, { format, timeZone }));

function parseArgs(values) {
  const options = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) throw new Error(`unknown argument: ${value}`);
    if (["--current-only"].includes(value)) {
      options.set(value, true);
      continue;
    }
    const next = values[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`missing value for ${value}`);
    options.set(value, next);
    index += 1;
  }
  return options;
}
