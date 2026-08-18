import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const humanCrowdPath = path.join(
  projectDir,
  "source-assets/public/match-runtime-min/data/stadiums/common/rural_crowd.png",
);
const referencePath = path.join(
  projectDir,
  "美术整体替换包/省份球场与观众/观众母版/乡村人类观众原图替换参考.webp",
);
const fitManifestPath = path.join(
  projectDir,
  "美术整体替换包/省份球场与观众/运行时预览/乡村四周观众-球员比例版.json",
);

const [humanCrowd, humanCrowdStat, reference] = await Promise.all([
  sharp(humanCrowdPath).metadata(),
  fs.stat(humanCrowdPath),
  sharp(referencePath).metadata(),
]);
assert.equal(humanCrowd.width, 4096, "人类观众贴图布局宽度必须保持 4096");
assert.equal(humanCrowd.height, 2048, "人类观众贴图布局高度必须保持 2048");
assert.ok(humanCrowd.hasAlpha, "人类观众必须保留透明中心与外侧");
assert.ok(humanCrowdStat.size < 3 * 1024 * 1024, `人类观众运行贴图过大: ${humanCrowdStat.size}`);
assert.ok(reference.width <= 768 && reference.height <= 768, "美术参考图必须保持小尺寸");

const { data, info } = await sharp(humanCrowdPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
assert.equal(alphaAt(Math.floor(info.width / 2), Math.floor(info.height / 2)), 0, "球场中央必须透明，不能盖住草坪");
assert.equal(alphaAt(10, Math.floor(info.height / 2)), 0, "场外必须透明，不能污染镜头边缘");

const bootSource = await fs.readFile(path.join(projectDir, "src/boot/start.js"), "utf8");
assert.ok(
  bootSource.includes("const mobileSafeFans = true;"),
  "动态观众必须关闭，避免与完整人类观众图叠加",
);

const buildSource = await fs.readFile(path.join(projectDir, "tools/build.mjs"), "utf8");
assert.ok(buildSource.includes('texture: "../common/rural_crowd.png"'), "构建期必须接入原布局的人类观众图");
assert.ok(buildSource.includes("scale: [1.25, 1.25]"), "人类观众必须使用原布局世界缩放，不能强行四倍放大");
const fitManifest = JSON.parse(await fs.readFile(fitManifestPath, "utf8"));
assert.deepEqual(fitManifest.worldScale, [1.25, 1.25], "观众必须留在球场世界层并跟随镜头");
assert.ok(fitManifest.horizontalSpectatorScale[0] <= 0.58 && fitManifest.horizontalSpectatorScale[1] <= 0.6, "上下看台观众必须缩到球员附近尺寸");
assert.ok(fitManifest.verticalSpectatorScale[0] <= 0.6 && fitManifest.verticalSpectatorScale[1] <= 0.58, "左右看台观众必须缩到球员附近尺寸");

console.info("[test-rural-audience-assets] PASS：观众球员比例、透明边界、世界镜头缩放和动态动物观众隔离正常");
