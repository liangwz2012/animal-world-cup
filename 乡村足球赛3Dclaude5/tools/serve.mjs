// 本地静态服务：只用来在浏览器里做观感和手感验收。

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..", "dist", "web");
const port = Number(process.env.PORT || 5177);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    const relative = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
    const file = join(rootDir, relative);
    if (!file.startsWith(rootDir)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    await stat(file);
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

server.listen(port, () => {
  console.log(`乡村足球赛 3D 本地预览：http://localhost:${port}`);
});
