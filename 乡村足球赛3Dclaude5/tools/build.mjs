// 构建：web（本地验收）与 wechat（小游戏上传包）。
// 产物先写到临时目录再原子替换，构建失败不会留下半个包。

import { build } from "esbuild";
import { cp, mkdir, readFile, rm, stat, writeFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = process.argv.slice(2);
const targetArg = args.find((a) => a.startsWith("--target="));
const targets = targetArg ? [targetArg.split("=")[1]] : ["web", "wechat"];
const minify = !args.includes("--no-minify");

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else total += (await stat(full)).size;
  }
  return total;
}

async function buildWeb() {
  const out = join(root, "dist", "web");
  const tmp = join(root, ".tmp", "web");
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const result = await build({
    entryPoints: [join(root, "src", "main-web.js")],
    bundle: true,
    format: "iife",
    target: ["es2020"],
    minify,
    sourcemap: false,
    outfile: join(tmp, "game.js"),
    metafile: true,
    legalComments: "none",
  });
  await writeFile(
    join(tmp, "index.html"),
    `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover" />
<title>乡村足球赛 3D</title>
<style>
  html,body{margin:0;height:100%;background:#0F1613;overflow:hidden;}
  canvas{display:block;touch-action:none;}
</style>
</head>
<body>
<canvas id="game"></canvas>
<script src="./game.js"></script>
</body>
</html>
`,
    "utf8",
  );
  // 人物检查台：只在 web 产物里，不进小游戏包
  await build({
    entryPoints: [join(root, "src", "main-inspect.js")],
    bundle: true,
    format: "iife",
    target: ["es2020"],
    minify,
    outfile: join(tmp, "inspect.js"),
    legalComments: "none",
  });
  await writeFile(
    join(tmp, "inspect.html"),
    `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" /><title>人物检查台</title>
<style>html,body{margin:0;height:100%;background:#0F1613;overflow:hidden;}canvas{display:block;touch-action:none;}</style>
</head><body><canvas id="game"></canvas><script src="./inspect.js"></script></body></html>
`,
    "utf8",
  );

  await rm(out, { recursive: true, force: true });
  await mkdir(dirname(out), { recursive: true });
  await cp(tmp, out, { recursive: true });
  const size = await dirSize(out);
  const bundle = (await stat(join(out, "game.js"))).size;
  console.log(`[web] dist/web 共 ${(size / 1024).toFixed(1)} KiB，game.js ${(bundle / 1024).toFixed(1)} KiB`);
  return { target: "web", size, bundle, metafile: result.metafile };
}

async function buildWechat() {
  const out = join(root, "dist", "wechat");
  const tmp = join(root, ".tmp", "wechat");
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  await build({
    entryPoints: [join(root, "src", "main-wechat.js")],
    bundle: true,
    format: "iife",
    target: ["es2019"],
    minify,
    sourcemap: false,
    outfile: join(tmp, "game.js"),
    legalComments: "none",
    define: { "process.env.NODE_ENV": '"production"' },
  });

  await writeFile(
    join(tmp, "game.json"),
    `${JSON.stringify(
      {
        deviceOrientation: "landscape",
        showStatusBar: false,
        networkTimeout: { request: 8000 },
        workers: "",
        subpackages: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await writeFile(
    join(tmp, "project.config.json"),
    `${JSON.stringify(
      {
        description: "乡村足球赛 3D —— 微信小游戏工程",
        packOptions: { ignore: [] },
        setting: {
          urlCheck: true,
          es6: false,
          enhance: false,
          postcss: false,
          minified: false,
          uglifyFileName: false,
          babelSetting: { ignore: [], disablePlugins: [], outputPath: "" },
        },
        compileType: "game",
        libVersion: "3.5.6",
        appid: "touristappid",
        projectname: "rural-football-3d",
        simulatorType: "wechat",
        simulatorPluginLibVersion: {},
        condition: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await rm(out, { recursive: true, force: true });
  await mkdir(dirname(out), { recursive: true });
  await cp(tmp, out, { recursive: true });
  const size = await dirSize(out);
  const bundle = (await stat(join(out, "game.js"))).size;
  console.log(`[wechat] dist/wechat 主包共 ${(size / 1024 / 1024).toFixed(2)} MiB，game.js ${(bundle / 1024).toFixed(1)} KiB`);
  return { target: "wechat", size, bundle };
}

const report = [];
for (const target of targets) {
  if (target === "web") report.push(await buildWeb());
  else if (target === "wechat") report.push(await buildWechat());
  else throw new Error(`未知构建目标：${target}`);
}

await mkdir(join(root, "dist"), { recursive: true });
await writeFile(
  join(root, "dist", "build-report.json"),
  `${JSON.stringify(
    {
      version: pkg.version,
      builtAt: new Date().toISOString(),
      minify,
      targets: report.map(({ target, size, bundle }) => ({ target, bytes: size, bundleBytes: bundle })),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
