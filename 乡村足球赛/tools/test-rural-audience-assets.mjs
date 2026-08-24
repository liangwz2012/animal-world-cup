import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

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
const sourceRacesDir = path.join(projectDir, "source-assets/public/match-runtime-min/data/player/races");
const runtimeRacesDir = path.join(projectDir, "runtime-assets/match-runtime-min/data/player/races");
const audienceMastersDir = path.join(projectDir, "美术整体替换包/乡村观众/masters");

const stadium = JSON.parse(await fs.readFile(runtimeStadiumPath, "utf8"));
assert.ok(stadium.fans, "球场必须保留原生观众系统");
assert.equal(stadium.fans.seats.length, 2342, "原生网页版 2342 个座位不得丢失");
assert.equal(stadium.fans.mask, "fansmask.png", "观众座位遮罩必须沿用原生资源");
assert.equal(stadium.fans.maxSkins, 48, "移动端动态观众应使用 48 套混合皮肤降低重复感");
assert.equal(stadium.fans.renderScale, 3, "48 套动态观众纹理应使用 3x 低内存渲染尺度");
const fanRaceIds = Object.keys(stadium.fans.races || {});
assert.equal(fanRaceIds.length, 48, "动态观众必须来自 48 名独立普通村民");
assert.ok(fanRaceIds.every((id) => /^crowd_\d{2}$/.test(id)), "观众不得复用14名球员或旧动物种族");
assert.ok(Math.abs(Object.values(stadium.fans.races).reduce((sum, value) => sum + value, 0) - 1) < 1e-6);
assert.equal(
  stadium.sprites.some((sprite) => /(?:^|\/)(?:fans|rural_crowd)\.png$/.test(String(sprite.texture || ""))),
  false,
  "球场不得再挂载静态观众围场图",
);

const generatedMatch = await fs.readFile(path.join(projectDir, "generated/match.static.js"), "utf8");
assert.ok(generatedMatch.includes("Math.min(t.fans.maxSkins||48,i.length)"), "村民观众皮肤上限未生效");
assert.ok(generatedMatch.includes("t.fans.renderScale||3"), "村民观众低内存纹理未生效");
assert.ok(generatedMatch.includes("__rfTextures") && generatedMatch.includes("__rfPhase"), "村民观众双帧与错峰动作未生效");
assert.ok(
  generatedMatch.includes("var D=M>2048?-1:1") && generatedMatch.includes("F.scale.x=w*V*D"),
  "观众必须沿用原生网页版左右侧脸与水平镜像朝向",
);
assert.ok(generatedMatch.includes("V=m.uniform(.92,1.06)"), "左右看台必须随机混排体型，不能形成一一镜像复制");
assert.ok(generatedMatch.includes("self._fanFrame++%4") && generatedMatch.includes("fan.texture=frames"), "2342名观众必须分四帧错峰更新双帧动作");
assert.equal(generatedMatch.includes("lookAngle=Math.atan2(1024-O,2048-M)"), false, "不得再径向旋转整个人物");
assert.equal(generatedMatch.includes("headLayer") || generatedMatch.includes("__rfHead"), false, "不得再叠加独立大头像层");
assert.ok(generatedMatch.includes("dynamic rural villagers placed:"), "动态观众挂载诊断日志缺失");

const digest = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const playerHeadDigests = new Set();
for (const name of await fs.readdir(sourceRacesDir)) {
  if (!/^rural_(?:v2_)?\d{2}$/.test(name)) continue;
  try { playerHeadDigests.add(digest(await fs.readFile(path.join(sourceRacesDir, name, "head.png")))); } catch (error) {}
}
const crowdFrontDigests = new Set();
for (const id of fanRaceIds) {
  const sourceDir = path.join(sourceRacesDir, id);
  const runtimeDir = path.join(runtimeRacesDir, id);
  for (const fileName of ["head.png", "head_back.png"]) {
    const [source, runtime, metadata, stat] = await Promise.all([
      fs.readFile(path.join(sourceDir, fileName)),
      fs.readFile(path.join(runtimeDir, fileName)),
      sharp(path.join(sourceDir, fileName)).metadata(),
      fs.stat(path.join(runtimeDir, fileName)),
    ]);
    assert.equal(metadata.width, 81);
    assert.equal(metadata.height, 77);
    assert.equal(metadata.hasAlpha, true);
    assert.ok(stat.size < 30 * 1024, `${id}/${fileName} 必须保持小尺寸压缩`);
    assert.equal(digest(source), digest(runtime), `${id}/${fileName} 构建同步必须无损`);
    assert.equal(playerHeadDigests.has(digest(source)), false, `${id}/${fileName} 不得复制任何球员头像`);
    if (fileName === "head.png") crowdFrontDigests.add(digest(source));
  }
}
assert.equal(crowdFrontDigests.size, 48, "48 名观众侧脸头像必须全部不同");

for (let index = 1; index <= 6; index += 1) {
  const master = path.join(audienceMastersDir, `crowd-side-heads-${String(index).padStart(2, "0")}.webp`);
  const [metadata, stat] = await Promise.all([sharp(master).metadata(), fs.stat(master)]);
  assert.equal(metadata.width, 768);
  assert.ok(metadata.height >= 384 && metadata.height <= 512);
  assert.ok(stat.size < 100 * 1024, "观众生图母版不得以高清 PNG 进入项目");
}
const audienceProvenance = await fs.readFile(path.join(audienceMastersDir, "README.md"), "utf8");
const audienceManifest = JSON.parse(await fs.readFile(path.join(audienceMastersDir, "crowd-head-manifest.json"), "utf8"));
assert.equal(audienceManifest.version, 2);
assert.equal(audienceManifest.direction, "right-facing-profile");
assert.equal(audienceManifest.count, 48);
assert.match(audienceProvenance, /Image2/);
assert.match(audienceProvenance, /不得用于主客队14名球员/);

const bootSource = await fs.readFile(path.join(projectDir, "src/boot/start.js"), "utf8");
assert.equal(bootSource.includes("createFanSpriteVisibilityBridge"), false, "稳定观众路径不得再安装独立头部桥接");
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
assert.equal(digest(sourceAudio), digest(runtimeAudio), "人类模糊人声必须从源资源无损同步到运行包");
assert.ok(audioStat.size > 100 * 1024 && audioStat.size < 400 * 1024, "人群环境声体积必须控制在 100–400 KiB");
assert.match(provenance, /Creative Commons 0|CC0/);
assert.match(provenance, /freesound\.org\/people\/Selector\/sounds\/365240/);
assert.match(provenance, /不可辨识|听不清|模糊人声/);

console.info("[test-rural-audience-assets] PASS：2342座、48名朝右侧脸村民、原生左右朝向、低内存双帧与人类模糊人声正常");
