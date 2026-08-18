import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { readRuralManifest, validateNoMagentaResidue } from "./lib/rural-art-contract.mjs";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const SPECIAL_CHARACTERS = Object.freeze({
  referee: {
    id: "referee",
    name: "标准人类裁判员",
    age: 39,
    profession: "足球裁判员",
  },
});

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--player") result.player = argv[++index];
    else if (argv[index] === "--input-root") result.inputRoot = argv[++index];
    else if (argv[index] === "--out") result.out = argv[++index];
    else if (argv[index] === "--manifest") result.manifest = argv[++index];
  }
  return result;
}

async function scaledPng(target, width, height) {
  return sharp(target)
    .resize(width, height, { fit: "contain", kernel: "nearest" })
    .png()
    .toBuffer();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.player) throw new Error("用法：npm run art:rural-preview -- --player <角色id> [--input-root <目录>] [--out <PNG>]");
  const manifest = await readRuralManifest(projectDir, args.manifest);
  const player = manifest.players.find((item) => item.id === args.player) || SPECIAL_CHARACTERS[args.player];
  if (!player) throw new Error(`未知角色 id：${args.player}`);
  const inputRoot = path.resolve(
    projectDir,
    args.inputRoot || "美术整体替换包/乡村队12人/v2/players",
  );
  const playerDir = path.join(inputRoot, player.id);
  for (const file of ["portrait.png", "head.png", "head_back.png"]) {
    await validateNoMagentaResidue(path.join(playerDir, file));
  }

  const output = path.resolve(
    projectDir,
    args.out || `美术整体替换包/乡村队12人/v2/preview/${player.id}-contact-sheet.png`,
  );
  const grass = `
    <svg width="768" height="432" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#75ad2b"/>
          <stop offset="1" stop-color="#4f8c20"/>
        </linearGradient>
        <pattern id="m" width="96" height="96" patternUnits="userSpaceOnUse">
          <rect width="48" height="96" fill="#ffffff" opacity=".025"/>
        </pattern>
      </defs>
      <rect width="768" height="432" rx="28" fill="url(#g)"/>
      <rect width="768" height="432" rx="28" fill="url(#m)"/>
      <path d="M384 0V432M270 216a114 114 0 1 0 228 0 114 114 0 1 0-228 0"
        fill="none" stroke="#eef5d7" stroke-width="5" opacity=".55"/>
      <rect x="24" y="24" width="720" height="384" rx="24"
        fill="none" stroke="#eef5d7" stroke-width="4" opacity=".55"/>
      <g font-family="PingFang SC,Arial,sans-serif" fill="#fff">
        <text x="44" y="67" font-size="25" font-weight="700">${player.name} · ${player.profession} · ${player.age}岁</text>
        <text x="44" y="98" font-size="17" opacity=".86">头像 / 严格正面 / 严格背面 · 原运行像素等比放大</text>
      </g>
    </svg>`;
  const portrait = await scaledPng(path.join(playerDir, "portrait.png"), 230, 230);
  const front = await scaledPng(path.join(playerDir, "head.png"), 207, 197);
  const back = await scaledPng(path.join(playerDir, "head_back.png"), 207, 197);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await sharp(Buffer.from(grass))
    .composite([
      { input: portrait, left: 54, top: 144 },
      { input: front, left: 304, top: 158 },
      { input: back, left: 532, top: 158 },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, quality: 88 })
    .toFile(output);
  console.info(`[art:rural-preview] PASS：${path.relative(projectDir, output)}`);
}

main().catch((error) => {
  console.error("[art:rural-preview] FAIL", error && error.message || error);
  process.exitCode = 1;
});
