import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export async function createPublicAssetService({ publicDir, useManifest = true } = {}) {
  const manifest = useManifest ? await readManifest(publicDir) : {};

  async function serve(res, pathname) {
    const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
    const target = path.resolve(publicDir, relative);
    if (!target.startsWith(`${publicDir}${path.sep}`) && target !== path.join(publicDir, "index.html")) {
      return json(res, 403, { ok: false, error: "Forbidden" });
    }
    try {
      if (!(await stat(target)).isFile()) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
      let content = await readFile(target);
      if (relative === "index.html") content = Buffer.from(injectManifest(content.toString("utf8"), manifest));
      res.writeHead(200, {
        "Content-Type": mimeType(target),
        "Content-Length": content.length,
        "Cache-Control": relative.startsWith("assets/")
          ? "public, max-age=31536000, immutable"
          : /\.html$/.test(relative) ? "no-cache" : "public, max-age=300, must-revalidate"
      });
      res.end(content);
    } catch (error) {
      if (error.code === "ENOENT") return json(res, 404, { ok: false, error: "Not found" });
      throw error;
    }
  }

  return { manifest, serve };
}

export function injectManifest(html, manifest = {}) {
  if (!manifest.version) return html;
  return String(html)
    .replace('href="/styles.css"', `href="${manifest.styles}"`)
    .replace('src="/app.js"', `src="${manifest.app}"`)
    .replace('src="/google-auth-ui.js"', `src="${manifest.googleAuth}"`);
}

async function readManifest(publicDir) {
  try {
    return JSON.parse(await readFile(path.join(publicDir, "assets", "manifest.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  }
}

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length });
  res.end(body);
}

function mimeType(file) {
  return ({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" })[path.extname(file)] || "application/octet-stream";
}
