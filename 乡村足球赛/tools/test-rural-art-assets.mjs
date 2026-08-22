import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  RURAL_ASSET_SPECS,
  RUNTIME_BODY_FILES,
  readRuralManifest,
  validatePlayerAssetDirectory,
  validateRgbaPng,
} from "./lib/rural-art-contract.mjs";

const require = createRequire(import.meta.url);
const { ruralMatchPlayersForSide, ruralRaceId } = require("../src/data/rural-squad.js");
const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const rosterDir = path.join(projectDir, "美术整体替换包", "乡村队12人", "players");
const sourceRuntime = path.join(projectDir, "source-assets", "public", "match-runtime-min");
const builtRuntime = path.join(projectDir, "runtime-assets", "match-runtime-min");
const TEAM_IDS = ["argentina", "brazil", "england", "france", "germany", "portugal", "spain", "usa"];

const manifest = await readRuralManifest(projectDir);
assert.equal(manifest.schemaVersion, 2);
assert.equal(manifest.players.length, 14);
assert.equal(new Set(manifest.players.map((player) => player.id)).size, 14);
assert.equal(manifest.generationMethod.assetEconomyPolicy.highResolutionGenerationByDefault, false);
assert.equal(manifest.generationMethod.assetEconomyPolicy.forbidLocalCandidateImitation, true);
assert.equal(manifest.generationMethod.assetEconomyPolicy.maxStoredReferenceEdge, 768);
assert.match(manifest.generationMethod.sourceSheet.center, /严格正面/);
assert.match(manifest.generationMethod.sourceSheet.center, /鼻尖居中/);
assert.match(manifest.generationMethod.sourceSheet.right, /严格背面/);
assert.match(manifest.generationMethod.sourceSheet.right, /不得出现眼睛/);
assert.equal(manifest.generationMethod.sourceSheet.background, "#FF00FF");
assert.match(manifest.generationMethod.ordinaryPeoplePolicy.goal, /普通人/);
assert.match(manifest.generationMethod.ordinaryPeoplePolicy.referenceBasis, /不复刻任何真实个人肖像/);
assert.ok(manifest.generationMethod.ordinaryPeoplePolicy.requiredVariation.length >= 5);
assert.ok(manifest.generationMethod.ordinaryPeoplePolicy.forbiddenBeautyBias.length >= 5);
assert.ok(manifest.generationMethod.avoid.some((item) => /偶像化/.test(item)));
assert.ok(manifest.generationMethod.avoid.some((item) => /洋红背景残边/.test(item)));
const averageAge = manifest.players.reduce((sum, player) => sum + player.age, 0) / manifest.players.length;
assert.equal(Number(averageAge.toFixed(2)), manifest.averageAge);
assert.ok(averageAge >= 28 && averageAge <= 35, "常规乡村队平均年龄必须在 28–35 岁");

for (const player of manifest.players) {
  assert.ok(["front", "left", "right"].includes(player.headHorizontalFacing), `${player.id} 必须声明正面头图的水平朝向`);
  const assets = await validatePlayerAssetDirectory(path.join(rosterDir, player.id));
  for (const file of ["head.png", "head_back.png"]) {
    assert.ok(assets[file].bounds.width >= 65, `${player.id}/${file} 必须与原动物保持接近的头部宽度`);
    assert.ok(assets[file].bounds.height >= 71, `${player.id}/${file} 必须与原动物保持接近的头部高度`);
  }
}

const templateRace = JSON.parse(await fs.readFile(
  path.join(sourceRuntime, "data", "player", "races", ruralRaceId(1), "race.json"),
  "utf8",
));
for (const [index] of manifest.players.entries()) {
  const raceId = ruralRaceId(index + 1);
  for (const runtimeRoot of [sourceRuntime, builtRuntime]) {
    const raceDir = path.join(runtimeRoot, "data", "player", "races", raceId);
    for (const file of RUNTIME_BODY_FILES) {
      await validateRgbaPng(path.join(raceDir, file), RURAL_ASSET_SPECS[file]);
    }
    const race = JSON.parse(await fs.readFile(path.join(raceDir, "race.json"), "utf8"));
    assert.deepEqual(race, templateRace, `${raceId} 不得改变原始 race 锚点、旋转和尺寸`);
  }
}

for (const teamId of TEAM_IDS) {
  for (const runtimeRoot of [sourceRuntime, builtRuntime]) {
    const team = JSON.parse(await fs.readFile(path.join(runtimeRoot, "data", "teams", teamId, "team.json"), "utf8"));
    const expected = ruralMatchPlayersForSide(teamId === "argentina" ? "red" : "blue");
    assert.equal(team.players.length, 7, `${teamId} 必须包含真实 7 人首发名单`);
    assert.deepEqual(
      team.players.map((player) => player.race),
      expected.map((player) => player.race),
      `${teamId} 的比赛人物必须与选队页对应阵营一致`,
    );
  }
}

console.info("[test-rural-art-assets] PASS：14 名球员 126 张分层、源码/构建产物、race 锚点和八队名单全部有效");
