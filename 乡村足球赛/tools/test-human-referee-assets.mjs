import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  validateNoMagentaResidue,
  validatePlayerAssetDirectory,
  validateRgbaPng,
} from "./lib/rural-art-contract.mjs";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const artDir = path.join(projectDir, "美术整体替换包", "裁判员", "v2", "referee");
const sourceKitDir = path.join(projectDir, "source-assets", "public", "rural-football", "kit-ref");
const runtimeKitDir = path.join(projectDir, "runtime-assets", "rural-football", "kit-ref");
const standalonePath = path.join(
  projectDir,
  "generated",
  "standalone.static.js",
);

const RUNTIME_SPECS = Object.freeze({
  "human_head.png": [81, 77],
  "human_head_back.png": [81, 77],
  "human_neck.png": [20, 18],
  "human_arm_left.png": [14, 11],
  "human_arm_right.png": [15, 17],
  "human_hand_left.png": [25, 28],
  "human_hand_right.png": [23, 38],
  "human_knee.png": [8, 9],
  "human_shirt.png": [56, 52],
  "human_shirt_front.png": [56, 52],
  "human_shirt_back.png": [56, 52],
  "human_sleeve_left.png": [14, 22],
  "human_sleeve_right.png": [23, 18],
  "human_shorts.png": [55, 8],
  "human_shorts_leg.png": [12, 16],
  "human_socks.png": [11, 14],
  "human_shoes.png": [16, 6],
});

async function assertBlackKit(target) {
  const { data, info } = await sharp(target).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let visible = 0;
  let black = 0;
  let redOrGold = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset + 3] <= 16) continue;
    visible += 1;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    if (Math.max(red, green, blue) <= 72) black += 1;
    if ((red >= 135 && red > green * 1.8) || (red >= 180 && green >= 120 && blue <= 100)) {
      redOrGold += 1;
    }
  }
  if (visible === 0 || black / visible < 0.58) {
    throw new Error(`${target} 墨黑裁判主色不足`);
  }
  if (/shirt|sleeve|shorts|socks/.test(path.basename(target)) && redOrGold === 0) {
    throw new Error(`${target} 缺少中国红或稻穗金乡村滚边`);
  }
}

async function main() {
  await validatePlayerAssetDirectory(artDir, { rejectMagentaResidue: true });
  for (const [file, size] of Object.entries(RUNTIME_SPECS)) {
    const source = path.join(sourceKitDir, file);
    const runtime = path.join(runtimeKitDir, file);
    const isKit = /shirt|sleeve|shorts|socks|shoes/.test(file);
    await validateRgbaPng(source, size, { transparentCorners: !isKit });
    await validateRgbaPng(runtime, size, { transparentCorners: !isKit });
    await validateNoMagentaResidue(source);
    await validateNoMagentaResidue(runtime);
    if (isKit) {
      await assertBlackKit(source);
      await assertBlackKit(runtime);
    }
  }
  const legacyFiles = (await fs.readdir(sourceKitDir)).filter((file) => file.startsWith("zebra_"));
  assert.equal(legacyFiles.length, 0, "正式素材目录不得再保留旧斑马裁判部件");
  const source = await fs.readFile(standalonePath, "utf8");
  for (const file of Object.keys(RUNTIME_SPECS)) {
    if (file === "human_shirt.png") continue; // 仅作正背带字球衣的安全回退母版
    if (!source.includes(file)) throw new Error(`比赛运行时未接入 ${file}`);
  }
  if (source.includes('facingCamera?"zebra_head.png"') || source.includes("var zebraParts=")) {
    throw new Error("比赛运行时仍在使用旧斑马裁判");
  }
  if (!source.includes("for(var hp in humanParts)") || !source.includes("sp2[hp].tint=16777215")) {
    throw new Error("人类裁判身体分层循环存在变量或贴图映射错误");
  }
  if (!source.includes('facingCamera?"human_shirt_front.png":"human_shirt_back.png"')) {
    throw new Error("裁判正背球衣没有按朝向切换");
  }
  const baseShirt = await fs.readFile(path.join(sourceKitDir, "human_shirt.png"));
  const frontShirt = await fs.readFile(path.join(sourceKitDir, "human_shirt_front.png"));
  const backShirt = await fs.readFile(path.join(sourceKitDir, "human_shirt_back.png"));
  assert.notDeepEqual(frontShirt, baseShirt, "裁判正面必须实际写入“裁判”文字");
  assert.notDeepEqual(backShirt, baseShirt, "裁判背面必须实际写入“裁判”文字");
  assert.notDeepEqual(frontShirt, backShirt, "裁判正背文字字号布局必须分别生成");
  console.info("[test:referee] PASS：标准人类裁判员已按原骨架尺寸接入，正背方向、墨黑红金乡村裁判服与回退素材均合格");
}

main().catch((error) => {
  console.error("[test:referee] FAIL", error && error.message || error);
  process.exitCode = 1;
});
