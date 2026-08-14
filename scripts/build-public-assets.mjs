import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const rootDir = path.resolve();
const publicDir = path.join(rootDir, "public");
const assetsDir = path.join(publicDir, "assets");

const result = await build({
  absWorkingDir: rootDir,
  bundle: true,
  chunkNames: "chunk-[hash]",
  entryNames: "[name]",
  entryPoints: {
    app: "public/app.js",
    "google-auth-ui": "public/google-auth-ui.js",
    styles: "public/styles.css"
  },
  format: "esm",
  legalComments: "none",
  metafile: true,
  minify: true,
  outdir: assetsDir,
  splitting: true,
  target: "es2022",
  write: false
});

const outputFiles = [...result.outputFiles].sort((left, right) => left.path.localeCompare(right.path));
const versionHash = createHash("sha256");
for (const file of outputFiles) {
  versionHash.update(path.basename(file.path));
  versionHash.update(file.contents);
}
const version = versionHash.digest("hex").slice(0, 16);

await rm(assetsDir, { recursive: true, force: true });
await mkdir(assetsDir, { recursive: true });
for (const file of outputFiles) await writeFile(file.path, file.contents);
await writeFile(path.join(assetsDir, "manifest.json"), `${JSON.stringify({
  version,
  styles: `/assets/styles.css?v=${version}`,
  app: `/assets/app.js?v=${version}`,
  googleAuth: `/assets/google-auth-ui.js?v=${version}`
}, null, 2)}\n`, "utf8");

const inputModules = Object.keys(result.metafile.inputs).filter((name) => name.endsWith(".js")).length;
process.stdout.write(`Built public assets ${version}: ${inputModules} modules -> ${outputFiles.length} files\n`);
