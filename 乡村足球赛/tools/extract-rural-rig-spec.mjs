import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const { BODY_PROFILES } = require("../src/data/player-body-profiles.js");

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const runtimeDir = path.join(projectDir, "source-assets", "public", "match-runtime-min");
const raceDir = path.join(runtimeDir, "data", "player", "races", "rural_v2_01");
const kitDir = path.join(runtimeDir, "data", "teams", "argentina", "home");
const outputPath = path.join(
  projectDir,
  "美术整体替换包",
  "乡村队12人",
  "rig",
  "rig-spec.json",
);

function parseArgs(argv) {
  return { check: argv.includes("--check") };
}

async function alphaBounds(target) {
  const image = sharp(target, { failOn: "error" }).ensureAlpha();
  const metadata = await image.metadata();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + info.channels - 1];
      if (alpha <= 16) continue;
      visiblePixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (visiblePixels === 0) throw new Error(`${target} 没有可见像素`);
  return {
    format: metadata.format,
    width: info.width,
    height: info.height,
    channels: info.channels,
    hasAlpha: metadata.hasAlpha === true,
    visibleBounds: {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
    visibleRatio: Number((visiblePixels / (info.width * info.height)).toFixed(6)),
  };
}

async function collectCharacterParts(race) {
  const result = {};
  for (const [slot, definition] of Object.entries(race)) {
    if (!definition || typeof definition !== "object" || !definition.name) continue;
    const assetName = path.basename(definition.name);
    const facts = await alphaBounds(path.join(raceDir, assetName));
    result[slot] = {
      asset: assetName,
      canvas: [facts.width, facts.height],
      channels: facts.channels,
      hasAlpha: facts.hasAlpha,
      visibleBounds: facts.visibleBounds,
      visibleRatio: facts.visibleRatio,
      anchor: {
        x: definition.x,
        y: definition.y,
        rotation: definition.rotation,
      },
      declaredFrame: [definition.width, definition.height],
    };
  }
  return result;
}

async function collectKitParts() {
  const result = {};
  const entries = (await fs.readdir(kitDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".png"))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const facts = await alphaBounds(path.join(kitDir, entry.name));
    result[entry.name] = {
      canvas: [facts.width, facts.height],
      channels: facts.channels,
      hasAlpha: facts.hasAlpha,
      visibleBounds: facts.visibleBounds,
      visibleRatio: facts.visibleRatio,
    };
  }
  return result;
}

async function collectSpec() {
  const race = JSON.parse(await fs.readFile(path.join(raceDir, "race.json"), "utf8"));
  const profiles = {};
  for (const [name, profile] of Object.entries(BODY_PROFILES)) {
    profiles[name] = {
      legacyRootScale: [profile.scaleX, profile.scaleY],
      label: profile.label,
    };
  }
  return {
    schemaVersion: 1,
    source: {
      race: "source-assets/public/match-runtime-min/data/player/races/rural_v2_01/race.json",
      kit: "source-assets/public/match-runtime-min/data/teams/argentina/home",
    },
    invariants: {
      preserveSkeletonAndAnimations: true,
      preservePhysicsAndCollision: true,
      preserveRaceAnchorsUntilGoldStandardPasses: true,
      runtimePngColorType: "RGBA",
      transparentCorners: true,
      generatedReferenceMaxEdge: 768,
      shirtTexturePixelScale: 1,
      minorKitTexturePixelScale: 1,
      kitAttachmentLogicalSizeUnchanged: true,
    },
    directions: {
      head_front: "strict-front-eyes-level-nose-centered",
      head_back: "strict-rear-no-face-features",
      horizontalMovement: "runtime-bone-rotation-and-mirroring",
    },
    characterParts: await collectCharacterParts(race),
    kitParts: await collectKitParts(),
    bodyProfiles: profiles,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const serialized = `${JSON.stringify(await collectSpec(), null, 2)}\n`;
  if (args.check) {
    const current = await fs.readFile(outputPath, "utf8");
    if (current !== serialized) {
      throw new Error("rig-spec.json 与当前 race/球衣素材不一致，请执行 npm run art:rural-rig-spec");
    }
    console.info("[art:rural-rig-spec] CHECK PASS：骨架规范与当前运行素材一致");
    return;
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, serialized);
  console.info(`[art:rural-rig-spec] PASS：已提取 ${path.relative(projectDir, outputPath)}`);
}

main().catch((error) => {
  console.error("[art:rural-rig-spec] FAIL", error && error.message || error);
  process.exitCode = 1;
});
