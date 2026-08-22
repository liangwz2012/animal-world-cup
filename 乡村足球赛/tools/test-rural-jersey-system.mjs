import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { validateNoMagentaResidue, validateRgbaPng } from "./lib/rural-art-contract.mjs";

const require = createRequire(import.meta.url);
const {
  RURAL_JERSEY_STYLES,
  RURAL_JERSEY_TEAM_IDS,
  teamIdForMatchSide,
  teamIdForRegion,
} = require("../src/data/rural-jersey-styles.js");
const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const sourceTeams = path.join(projectDir, "source-assets", "public", "match-runtime-min", "data", "teams");
const runtimeTeams = path.join(projectDir, "runtime-assets", "match-runtime-min", "data", "teams");
const backupDir = path.join(projectDir, "美术替换备份", "2026-07-30-全队乡村球衣应用前");
const mastersDir = path.join(projectDir, "美术整体替换包", "乡村球衣系统", "image2-masters");

const KITS = Object.freeze(["home", "away", "goalkeeper"]);
const PIECES = Object.freeze({
  "shirt_front.png": [56, 52],
  "shirt_back.png": [56, 52],
  "sleeve_left.png": [14, 22],
  "sleeve_right.png": [23, 18],
  "shorts.png": [55, 8],
  "shorts_leg_left.png": [12, 16],
  "shorts_leg_right.png": [12, 16],
  "socks.png": [11, 14],
  "socks_left.png": [11, 14],
  "socks_right.png": [11, 14],
  "shoes_left.png": [16, 6],
  "shoes_right.png": [16, 6],
});
const SLOT_FILES = Object.freeze({
  arm_left_sleeve: "sleeve_left.png",
  arm_right_sleeve: "sleeve_right.png",
  shirt_front: "shirt_front.png",
  shirt_back: "shirt_back.png",
  pelvis_shorts: "shorts.png",
  leg_left_shorts: "shorts_leg_left.png",
  leg_right_shorts: "shorts_leg_right.png",
  leg_left_sock: "socks_left.png",
  leg_right_sock: "socks_right.png",
  leg_left_shoe: "shoes_left.png",
  leg_right_shoe: "shoes_right.png",
});

function outputScaleForPiece(file) {
  return 1;
}

function colorSaturation(hex) {
  const value = Number.parseInt(String(hex).replace(/^#/, ""), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => channel / 255);
  const maximum = Math.max(...channels);
  const minimum = Math.min(...channels);
  return maximum ? (maximum - minimum) / maximum : 0;
}

async function digest(target) {
  return crypto.createHash("sha256").update(await fs.readFile(target)).digest("hex");
}

async function visibleColorBuckets(target) {
  const { data, info } = await sharp(target).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map();
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset + 3] <= 32) continue;
    const key = [data[offset], data[offset + 1], data[offset + 2]]
      .map((value) => Math.round(value / 24))
      .join(",");
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return Array.from(buckets.values()).filter((count) => count >= 5).length;
}

async function normalizedAlphaBounds(target) {
  const { data, info } = await sharp(target).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + info.channels - 1];
      if (alpha <= 16) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  assert.ok(maxX >= minX && maxY >= minY, `${target} 不得是全透明素材`);
  return [minX / info.width, minY / info.height, (maxX + 1) / info.width, (maxY + 1) / info.height];
}

async function alphaShapeIoU(target, baseline) {
  const targetMeta = await sharp(target).metadata();
  const [current, original] = await Promise.all([
    sharp(target).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(baseline)
      .resize(targetMeta.width, targetMeta.height, { fit: "fill", kernel: targetMeta.width > 56 ? "nearest" : "lanczos3" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < current.info.width * current.info.height; index += 1) {
    const currentVisible = current.data[index * current.info.channels + current.info.channels - 1] > 16;
    const originalVisible = original.data[index * original.info.channels + original.info.channels - 1] > 16;
    if (currentVisible || originalVisible) union += 1;
    if (currentVisible && originalVisible) intersection += 1;
  }
  return union ? intersection / union : 0;
}

async function main() {
  assert.equal(RURAL_JERSEY_STYLES.length, 8, "必须存在8套乡村球衣");
  assert.equal(new Set(RURAL_JERSEY_TEAM_IDS).size, 8, "运行球队映射不得重复");
  assert.equal(new Set(RURAL_JERSEY_STYLES.map((style) => style.id)).size, 8, "乡村纹样不得重复");
  const region = { locationCodes: ["440983", "440983101000"], locationLabel: "镇隆" };
  const stable = teamIdForRegion(region);
  assert.equal(teamIdForRegion(region), stable, "同一地区的球衣模板必须稳定");
  assert.notEqual(teamIdForRegion(region, stable), stable, "主客队模板冲突时必须换成另一套");
  assert.equal(teamIdForMatchSide("red", region), "argentina", "主队地区变化后必须仍使用红金主场球衣");
  assert.equal(teamIdForMatchSide("blue", region), "portugal", "客队地区变化后必须仍使用蓝色球衣");
  const playerSkeleton = JSON.parse(await fs.readFile(
    path.join(projectDir, "source-assets", "public", "match-runtime-min", "data", "player.json"),
    "utf8",
  ));
  for (const animation of ["idle", "walk", "run", "sprint", "shoot", "slide", "fall_forward", "knee_slide"]) {
    assert.ok(playerSkeleton.animations[animation], `原骨架缺少 ${animation} 动作`);
    assert.ok(playerSkeleton.animations[`${animation}_back`], `原骨架缺少 ${animation}_back 背向动作`);
  }
  const generatedMatch = await fs.readFile(path.join(projectDir, "generated", "match.static.js"), "utf8");
  assert.match(
    generatedMatch,
    /chest_shirt:\{shirt_back:[^}]+shirt_front:/,
    "球衣正背面必须继续绑定同一个 chest_shirt 动作槽",
  );
  assert.match(generatedMatch, /strokeThickness:1/, "数字号码必须使用清晰细描边");

  const masterManifest = JSON.parse(await fs.readFile(path.join(mastersDir, "manifest.json"), "utf8"));
  assert.equal(masterManifest.generator, "OpenAI Image2", "正式球衣必须来自 Image2 母版");
  assert.equal(Object.keys(masterManifest.masters || {}).length, 8, "必须保留8套压缩 Image2 母版");

  for (const style of RURAL_JERSEY_STYLES) {
    assert.ok(colorSaturation(style.away.primary) >= 0.55, `${style.label} 客场服必须使用鲜艳高对比主色，禁止灰白主色`);
    const master = path.join(mastersDir, `${style.id}.webp`);
    const masterMetadata = await sharp(master).metadata();
    assert.equal(masterMetadata.hasAlpha, true, `${style.id} 母版必须清除背景并保留透明通道`);
    await fs.access(path.join(backupDir, style.teamId, "team.json"));
    const definitionPath = path.join(sourceTeams, style.teamId, "team.json");
    const team = JSON.parse(await fs.readFile(definitionPath, "utf8"));
    const baselineTeam = JSON.parse(await fs.readFile(path.join(backupDir, style.teamId, "team.json"), "utf8"));
    assert.equal(team.kitColors.home, style.home.primary.slice(1).toLowerCase());
    assert.equal(team.kitColors.away, style.away.primary.slice(1).toLowerCase());
    assert.equal(team.kitColors.goalkeeper, style.goalkeeper.primary.slice(1).toLowerCase());
    for (const kitName of KITS) {
      const kit = team.kits[kitName];
      for (const [slot, file] of Object.entries(SLOT_FILES)) {
        assert.equal(kit[slot].name, `${kitName}/${file}`, `${style.teamId}/${kitName}/${slot} 未使用整套本地球衣`);
        assert.equal(kit[slot].color, "ffffffff", `${style.teamId}/${kitName}/${slot} 不应残留国家队染色`);
        assert.deepEqual(
          [kit[slot].width, kit[slot].height],
          PIECES[file],
          `${style.teamId}/${kitName}/${slot} 逻辑尺寸和骨架锚点不得随母版像素放大`,
        );
        for (const property of ["x", "y", "rotation", "width", "height"]) {
          assert.equal(
            kit[slot][property],
            baselineTeam.kits[kitName][slot][property],
            `${style.teamId}/${kitName}/${slot}.${property} 必须保持原动作骨架绑定`,
          );
        }
      }
      assert.ok(kit.number && /number\.png$/.test(kit.number.name), `${style.teamId}/${kitName} 必须保留数字号码图层`);
      assert.ok(kit.number.x <= kit.shirt_back.x - 5, `${style.teamId}/${kitName} 数字号码必须位于背部中下段`);
      assert.equal(kit.number.y, baselineTeam.kits[kitName].number.y, `${style.teamId}/${kitName} 号码横向中心不得漂移`);
      assert.equal(kit.number.rotation, baselineTeam.kits[kitName].number.rotation, `${style.teamId}/${kitName} 号码必须跟随胸部骨骼方向`);
      for (const [file, size] of Object.entries(PIECES)) {
        const source = path.join(sourceTeams, style.teamId, kitName, file);
        const runtime = path.join(runtimeTeams, style.teamId, kitName, file);
        const physicalSize = size.map((value) => value * outputScaleForPiece(file));
        await validateRgbaPng(source, physicalSize, { transparentCorners: false, requireTransparentPadding: false });
        await validateRgbaPng(runtime, physicalSize, { transparentCorners: false, requireTransparentPadding: false });
        const palette = style[kitName];
        const intentionalPurple = Object.values(palette).some((hex) => {
          const value = Number.parseInt(hex.slice(1), 16);
          const red = (value >> 16) & 255;
          const green = (value >> 8) & 255;
          const blue = value & 255;
          return red >= 120 && blue >= 80 && Math.min(red, blue) - green >= 38;
        });
        if (!intentionalPurple) await validateNoMagentaResidue(source, { allowedRatio: 0.0015 });
        const [currentBounds, baselineBounds] = await Promise.all([
          normalizedAlphaBounds(source),
          normalizedAlphaBounds(path.join(backupDir, style.teamId, kitName, file)),
        ]);
        currentBounds.forEach((value, index) => {
          assert.ok(
            Math.abs(value - baselineBounds[index]) <= 0.035,
            `${style.teamId}/${kitName}/${file} 透明轮廓偏离原动作蒙版`,
          );
        });
        assert.ok(
          await alphaShapeIoU(source, path.join(backupDir, style.teamId, kitName, file)) >= 0.999,
          `${style.teamId}/${kitName}/${file} 必须严格使用原动作部件蒙版`,
        );
        assert.equal(await digest(runtime), await digest(source), `${style.teamId}/${kitName}/${file} 构建产物未同步`);
      }
      const colorBuckets = await visibleColorBuckets(path.join(sourceTeams, style.teamId, kitName, "shirt_front.png"));
      assert.ok(colorBuckets >= 2, `${style.label}/${kitName} 缺少可读的乡村纹样和配色层次`);
    }
    const original = path.join(backupDir, style.teamId, "home", "shirt_front.png");
    const current = path.join(sourceTeams, style.teamId, "home", "shirt_front.png");
    assert.notEqual(await digest(original), await digest(current), `${style.label} 仍是旧国家队球衣`);
  }
  await fs.access(path.join(projectDir, "美术整体替换包", "乡村球衣系统", "八套乡村球衣预览.png"));
  await fs.access(path.join(projectDir, "美术整体替换包", "乡村球衣系统", "Image2正式球衣母版预览.webp"));
  console.info("[test:rural-jerseys] PASS：8套 Image2 母版、1倍运行尺寸、动作锚点、原轮廓、数字号码和构建同步均合格");
}

main().catch((error) => {
  console.error("[test:rural-jerseys] FAIL", error && error.message || error);
  process.exitCode = 1;
});
