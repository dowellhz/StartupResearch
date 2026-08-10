import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const roots = ["server.mjs", "src", "public", "tests", "scripts"];
const files = [];

async function walk(target) {
  const stat = await import("node:fs/promises").then(({ stat }) => stat(target));
  if (stat.isFile()) return files.push(target);
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) await walk(child);
    else if (/\.(?:js|mjs|css|html|md)$/.test(entry.name)) files.push(child);
  }
}

for (const root of roots) await walk(root);
const errors = [];
for (const file of files) {
  const text = await readFile(file, "utf8");
  if (/\r/.test(text)) errors.push(`${file}: contains CRLF`);
  if (/^(?:<{7}|={7}|>{7})/m.test(text)) errors.push(`${file}: contains conflict marker`);
  text.split("\n").forEach((line, index) => {
    if (/[ \t]+$/.test(line)) errors.push(`${file}:${index + 1}: trailing whitespace`);
  });
  if (file.startsWith(`src${path.sep}`)
      && file !== path.join("src", "config", "runtime-config.js")
      && (/process\.env/.test(text) || /env(?:\.|\[)["']?DEEPSEEK_API_KEY/.test(text))) {
    errors.push(`${file}: runtime credentials must be read only by src/config/runtime-config.js`);
  }
}
if (errors.length) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Style check passed (${files.length} files).\n`);
}
