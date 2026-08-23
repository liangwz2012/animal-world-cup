import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeStadiumPath = path.join(
  projectDir,
  "runtime-assets/match-runtime-min/data/stadiums/international/stadium.json",
);
const sourceCrowdPath = path.join(
  projectDir,
  "source-assets/public/match-runtime-min/data/stadiums/common/rural_crowd.png",
);
const runtimeCrowdPath = path.join(
  projectDir,
  "runtime-assets/match-runtime-min/data/stadiums/common/rural_crowd.png",
);
const sourceFansStripPath = path.join(
  projectDir,
  "source-assets/public/match-runtime-min/data/stadiums/common/fans.png",
);
const runtimeFansStripPath = path.join(
  projectDir,
  "runtime-assets/match-runtime-min/data/stadiums/common/fans.png",
);
const sourceAudioPath = path.join(projectDir, "source-assets/public/rural-football/audio/crowd_ambience.mp3");
const runtimeAudioPath = path.join(projectDir, "runtime-assets/rural-football/audio/crowd_ambience.mp3");
const provenancePath = path.join(projectDir, "source-assets/public/rural-football/audio/CROWD_AMBIENCE_PROVENANCE.md");

const stadium = JSON.parse(await fs.readFile(runtimeStadiumPath, "utf8"));
assert.ok(stadium.fans, "球场必须保留原生观众系统");
assert.equal(stadium.fans.seats.length, 2342, "原生网页版 2342 个座位不得丢失");
assert.equal(stadium.fans.mask, "fansmask.png", "观众座位遮罩必须沿用原生资源");
assert.equal(stadium.fans.maxSkins, 24, "移动端动态观众应限制为 24 套复用皮肤");
assert.equal(stadium.fans.renderScale, 4, "动态观众纹理应使用 4x 低内存渲染尺度");
const fanRaceIds = Object.keys(stadium.fans.races || {});
assert.equal(fanRaceIds.length, 14, "动态观众必须来自 14 名人类村民");
assert.ok(fanRaceIds.every((id) => /^rural_\d{2}$/.test(id)), "动态观众不得混入旧动物种族");
assert.equal(
  stadium.sprites.some((sprite) => /(?:^|\/)(?:fans|rural_crowd)\.png$/.test(String(sprite.texture || ""))),
  false,
  "球场不得再挂载静态观众围场图",
);

const generatedMatch = await fs.readFile(path.join(projectDir, "generated/match.static.js"), "utf8");
assert.ok(generatedMatch.includes("Math.min(t.fans.maxSkins||24,i.length)"), "村民观众皮肤上限未生效");
assert.ok(generatedMatch.includes("t.fans.renderScale||4"), "村民观众低内存纹理未生效");
assert.ok(generatedMatch.includes("__rfTextures") && generatedMatch.includes("__rfPhase"), "村民观众双帧与错峰动作未生效");
assert.ok(generatedMatch.includes("dynamic rural villagers placed:"), "动态观众挂载诊断日志缺失");

const bootSource = await fs.readFile(path.join(projectDir, "src/boot/start.js"), "utf8");
assert.ok(bootSource.includes("const mobileSafeFans = false;"), "动态村民观众仍被启动画像强制关闭");
assert.ok(bootSource.includes("dynamic-rural-fans"), "设备画像未标记动态村民观众");

for (const obsoletePath of [sourceCrowdPath, runtimeCrowdPath, sourceFansStripPath, runtimeFansStripPath]) {
  await assert.rejects(fs.access(obsoletePath), "弃用静态观众图不得留在正式资源包");
}

const [sourceAudio, runtimeAudio, audioStat, provenance] = await Promise.all([
  fs.readFile(sourceAudioPath),
  fs.readFile(runtimeAudioPath),
  fs.stat(runtimeAudioPath),
  fs.readFile(provenancePath, "utf8"),
]);
const digest = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
assert.equal(digest(sourceAudio), digest(runtimeAudio), "人类模糊人声必须从源资源无损同步到运行包");
assert.ok(audioStat.size > 100 * 1024 && audioStat.size < 400 * 1024, "人群环境声体积必须控制在 100–400 KiB");
assert.match(provenance, /Creative Commons 0|CC0/);
assert.match(provenance, /freesound\.org\/people\/Selector\/sounds\/365240/);
assert.match(provenance, /不可辨识|听不清|模糊人声/);

console.info("[test-rural-audience-assets] PASS：2342座动态村民、低内存双帧、静态围场隔离与人类模糊人声正常");
