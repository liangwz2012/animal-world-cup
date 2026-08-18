import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { readRuralManifest, validateRgbaPng } from "./lib/rural-art-contract.mjs";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const rosterDir = path.join(projectDir, "美术整体替换包", "乡村队12人", "players");
const SPECIAL_CHARACTERS = Object.freeze({
  referee: {
    id: "referee",
    name: "标准人类裁判员",
    age: 39,
    gender: "男",
    profession: "足球裁判员",
    skinTone: "#C47F55",
  },
});

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--player") result.player = argv[++index];
    else if (argv[index] === "--output-root") result.outputRoot = argv[++index];
    else if (argv[index] === "--manifest") result.manifest = argv[++index];
  }
  return result;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function shade(hex, amount) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`无效肤色：${hex}`);
  const value = Number.parseInt(match[1], 16);
  const rgb = [
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ].map((channel) => clamp(channel + amount, 0, 255));
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function svgFrame(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

function capsule(width, height, skin, angle = 0, inset = 1) {
  const light = shade(skin, 22);
  const shadow = shade(skin, -28);
  const outline = shade(skin, -58);
  const cx = width / 2;
  const cy = height / 2;
  const rx = Math.max(1, (width - inset * 2) / 2);
  const ry = Math.max(1, (height - inset * 2) / 2);
  return svgFrame(width, height, `
    <defs>
      <linearGradient id="skin" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${light}"/>
        <stop offset="0.55" stop-color="${skin}"/>
        <stop offset="1" stop-color="${shadow}"/>
      </linearGradient>
    </defs>
    <g transform="rotate(${angle} ${cx} ${cy})">
      <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#skin)" stroke="${outline}" stroke-width="0.7"/>
      <ellipse cx="${cx - rx * 0.22}" cy="${cy - ry * 0.27}" rx="${Math.max(0.6, rx * 0.28)}" ry="${Math.max(0.45, ry * 0.13)}" fill="${light}" opacity="0.62"/>
    </g>
  `);
}

function hand(width, height, skin, mirrored = false) {
  const light = shade(skin, 20);
  const shadow = shade(skin, -30);
  const outline = shade(skin, -62);
  const transform = mirrored ? `translate(${width} 0) scale(-1 1)` : "";
  const palmX = width * 0.28;
  const palmY = height * 0.25;
  const palmW = width * 0.48;
  const palmH = height * 0.54;
  return svgFrame(width, height, `
    <defs>
      <linearGradient id="skin" x1="0" y1="0" x2="0.9" y2="1">
        <stop offset="0" stop-color="${light}"/>
        <stop offset="0.58" stop-color="${skin}"/>
        <stop offset="1" stop-color="${shadow}"/>
      </linearGradient>
    </defs>
    <g transform="${transform}">
      <rect x="${palmX}" y="${palmY}" width="${palmW}" height="${palmH}" rx="${Math.max(2, width * 0.18)}" fill="url(#skin)" stroke="${outline}" stroke-width="0.75"/>
      <ellipse cx="${width * 0.29}" cy="${height * 0.52}" rx="${width * 0.16}" ry="${height * 0.1}" fill="${skin}" stroke="${outline}" stroke-width="0.65" transform="rotate(-35 ${width * 0.29} ${height * 0.52})"/>
      <path d="M ${width * 0.39} ${height * 0.29} L ${width * 0.39} ${height * 0.18}
               M ${width * 0.5} ${height * 0.27} L ${width * 0.5} ${height * 0.14}
               M ${width * 0.61} ${height * 0.29} L ${width * 0.61} ${height * 0.17}
               M ${width * 0.7} ${height * 0.33} L ${width * 0.7} ${height * 0.23}"
            fill="none" stroke="${outline}" stroke-width="1.35" stroke-linecap="round"/>
      <ellipse cx="${width * 0.46}" cy="${height * 0.35}" rx="${width * 0.11}" ry="${height * 0.045}" fill="${light}" opacity="0.55"/>
    </g>
  `);
}

function partSvg(file, skin) {
  switch (file) {
    case "neck.png":
      return capsule(20, 18, skin, -4, 2);
    case "arm_left.png":
      return capsule(14, 11, skin, -18, 1);
    case "arm_right.png":
      return capsule(15, 17, skin, 17, 1);
    case "hand_left.png":
      return hand(25, 28, skin, false);
    case "hand_right.png":
      return hand(23, 38, skin, true);
    case "knee.png":
      return capsule(8, 9, skin, 0, 1);
    default:
      throw new Error(`未知身体分层：${file}`);
  }
}

const BODY_SPECS = Object.freeze({
  "neck.png": [20, 18],
  "arm_left.png": [14, 11],
  "arm_right.png": [15, 17],
  "hand_left.png": [25, 28],
  "hand_right.png": [23, 38],
  "knee.png": [8, 9],
});

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function sampleSkinTone(portraitPath, fallback) {
  try {
    const { data, info } = await sharp(portraitPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const samples = [];
    for (let offset = 0; offset < data.length; offset += info.channels) {
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const alpha = data[offset + 3];
      // 排除蓝色球衣、黑发、眼白和高光，只保留中间亮度的暖色皮肤像素。
      if (
        alpha > 224
        && red >= 90
        && red > green * 1.08
        && green > blue * 1.03
        && red - blue >= 34
        && red + green + blue >= 250
        && red + green + blue <= 650
      ) {
        samples.push([red, green, blue]);
      }
    }
    if (samples.length < 64) return fallback;
    return `#${[0, 1, 2]
      .map((channel) => median(samples.map((sample) => sample[channel])).toString(16).padStart(2, "0"))
      .join("")}`;
  } catch {
    return fallback;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = await readRuralManifest(projectDir, args.manifest);
  const catalog = [...manifest.players, ...Object.values(SPECIAL_CHARACTERS)];
  const players = args.player
    ? catalog.filter((player) => player.id === args.player)
    : manifest.players;
  if (players.length === 0) throw new Error(`未知角色 id：${args.player}`);
  const outputRoot = args.outputRoot ? path.resolve(projectDir, args.outputRoot) : rosterDir;
  const relativeOutputRoot = path.relative(projectDir, outputRoot);
  if (relativeOutputRoot.startsWith("..") || path.isAbsolute(relativeOutputRoot)) {
    throw new Error("output-root 必须位于项目目录内");
  }
  for (const player of players) {
    const playerDir = path.join(outputRoot, player.id);
    await fs.mkdir(playerDir, { recursive: true });
    const sampledSkinTone = await sampleSkinTone(path.join(playerDir, "portrait.png"), player.skinTone);
    for (const [file, size] of Object.entries(BODY_SPECS)) {
      const target = path.join(playerDir, file);
      await sharp(Buffer.from(partSvg(file, sampledSkinTone))).png().toFile(target);
      await validateRgbaPng(target, size);
    }
    await fs.writeFile(
      path.join(playerDir, "skin-source.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        player: player.id,
        source: "portrait.png",
        sampledSkinTone,
        fallbackSkinTone: player.skinTone,
      }, null, 2)}\n`,
    );
  }
  console.info(
    `[art:rural-body-parts] PASS：已从同一人物母版采样肤色并生成 ${players.length * Object.keys(BODY_SPECS).length} 张独立人体分层`,
  );
}

main().catch((error) => {
  console.error("[art:rural-body-parts] FAIL", error && error.message || error);
  process.exitCode = 1;
});
