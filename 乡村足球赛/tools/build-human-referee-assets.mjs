import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { validateRgbaPng, validateNoMagentaResidue } from "./lib/rural-art-contract.mjs";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const sourceDir = path.join(projectDir, "美术整体替换包", "裁判员", "v2", "referee");
const kitDir = path.join(projectDir, "source-assets", "public", "rural-football", "kit-ref");

const HUMAN_PARTS = Object.freeze({
  "head.png": ["human_head.png", [81, 77]],
  "head_back.png": ["human_head_back.png", [81, 77]],
  "neck.png": ["human_neck.png", [20, 18]],
  "arm_left.png": ["human_arm_left.png", [14, 11]],
  "arm_right.png": ["human_arm_right.png", [15, 17]],
  "hand_left.png": ["human_hand_left.png", [25, 28]],
  "hand_right.png": ["human_hand_right.png", [23, 38]],
  "knee.png": ["human_knee.png", [8, 9]],
});

const KIT_PARTS = Object.freeze({
  "shirt_front.png": ["human_shirt.png", [56, 52]],
  "sleeve_left.png": ["human_sleeve_left.png", [14, 22]],
  "sleeve_right.png": ["human_sleeve_right.png", [23, 18]],
  "shorts.png": ["human_shorts.png", [55, 8]],
  "shorts_leg.png": ["human_shorts_leg.png", [12, 16]],
  "socks.png": ["human_socks.png", [11, 14]],
  "shoes.png": ["human_shoes.png", [16, 6]],
});

async function makeBlackKit(source, target, expected) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const alpha = data[offset + 3];
      if (alpha === 0) continue;
      const vertical = info.height <= 1 ? 0 : 1 - y / (info.height - 1);
      const horizontal = info.width <= 1 ? 0 : x / (info.width - 1);
      const normalizedY = info.height <= 1 ? 0 : y / (info.height - 1);
      const normalizedX = info.width <= 1 ? 0 : x / (info.width - 1);
      const isShoe = target.endsWith("human_shoes.png");
      const isSock = target.endsWith("human_socks.png");
      const isShorts = target.includes("human_shorts");
      const isSleeve = target.includes("human_sleeve");
      const isShirt = target.endsWith("human_shirt.png");
      const redTrim = !isShoe && (
        (isShirt && (normalizedY < 0.07 || normalizedX < 0.045 || normalizedX > 0.955))
        || (isSleeve && normalizedY > 0.72)
        || (isShorts && (normalizedX < 0.08 || normalizedX > 0.92))
        || (isSock && normalizedY < 0.2)
      );
      const goldTrim = !isShoe && (
        (isShirt && normalizedY >= 0.07 && normalizedY < 0.115)
        || (isSleeve && normalizedY > 0.62 && normalizedY <= 0.72)
        || (isShorts && normalizedY < 0.14)
        || (isSock && normalizedY >= 0.2 && normalizedY < 0.32)
      );
      if (redTrim) {
        data[offset] = 176;
        data[offset + 1] = 49;
        data[offset + 2] = 43;
      } else if (goldTrim) {
        data[offset] = 226;
        data[offset + 1] = 178;
        data[offset + 2] = 62;
      } else {
        const value = Math.round(17 + vertical * 23 + horizontal * 5);
        data[offset] = value;
        data[offset + 1] = value + 2;
        data[offset + 2] = value + 4;
      }
    }
  }
  await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  }).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(target);
  // 服装切片继承原骨架轮廓，部分切片会自然贴到画布边缘；这不是方形底色。
  await validateRgbaPng(target, expected, { transparentCorners: false });
}

async function makeLabeledShirt(basePath, targetPath, fontSize, y) {
  const label = Buffer.from(`
    <svg width="56" height="52" xmlns="http://www.w3.org/2000/svg">
      <text x="28" y="${y}" text-anchor="middle"
        font-family="PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
        font-size="${fontSize}" font-weight="900"
        fill="#F7E39A" stroke="#351E10" stroke-width="0.9" paint-order="stroke">裁判</text>
    </svg>
  `);
  await sharp(basePath)
    .composite([{ input: label, left: 0, top: 0 }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(targetPath);
  await validateRgbaPng(targetPath, [56, 52], { transparentCorners: false });
}

async function main() {
  await fs.mkdir(kitDir, { recursive: true });
  for (const [sourceName, [targetName, expected]] of Object.entries(HUMAN_PARTS)) {
    const source = path.join(sourceDir, sourceName);
    const target = path.join(kitDir, targetName);
    await fs.copyFile(source, target);
    await validateRgbaPng(target, expected);
    await validateNoMagentaResidue(target);
  }
  for (const [sourceName, [targetName, expected]] of Object.entries(KIT_PARTS)) {
    await makeBlackKit(path.join(kitDir, sourceName), path.join(kitDir, targetName), expected);
  }
  const shirtBase = path.join(kitDir, "human_shirt.png");
  await makeLabeledShirt(shirtBase, path.join(kitDir, "human_shirt_front.png"), 9, 28);
  await makeLabeledShirt(shirtBase, path.join(kitDir, "human_shirt_back.png"), 11, 29);
  console.info("[art:referee] PASS：标准人类裁判员分层与墨黑红金乡村裁判服已生成；斑马旧素材仍保留用于回退");
}

main().catch((error) => {
  console.error("[art:referee] FAIL", error && error.message || error);
  process.exitCode = 1;
});
