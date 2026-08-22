import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import sharp from "sharp";
import {
  RURAL_ASSET_SPECS,
  RUNTIME_BODY_FILES,
  readRuralManifest,
  validatePlayerAssetDirectory,
  validateRgbaPng,
} from "./lib/rural-art-contract.mjs";

const require = createRequire(import.meta.url);
const {
  RURAL_SQUAD,
  legacyRuralRaceId,
  ruralMatchPlayersForSide,
  ruralRaceId,
} = require("../src/data/rural-squad.js");

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const sourcesDir = path.join(projectDir, "source-assets");
const kitDir = path.join(projectDir, "美术整体替换包", "乡村队12人");
const rosterDir = path.join(kitDir, "players");
const v2RosterDir = path.join(kitDir, "v2", "players");
const racesDir = path.join(sourcesDir, "public", "match-runtime-min", "data", "player", "races");
const teamsDir = path.join(sourcesDir, "public", "match-runtime-min", "data", "teams");
const portraitDir = path.join(sourcesDir, "public", "rural-football", "portraits");
const backupDir = path.join(projectDir, "美术替换备份", `${new Date().toISOString().replace(/[:.]/g, "-")}-乡村队12人应用前`);
const stageDir = path.join(projectDir, ".tmp", `rural-art-${process.pid}-${Date.now()}`);
const TEAM_IDS = ["argentina", "brazil", "england", "france", "germany", "portugal", "spain", "usa"];

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

function personDir(person, index) {
  return path.join(index === 0 ? v2RosterDir : rosterDir, person.id);
}

async function validateBeforeMutation() {
  const manifest = await readRuralManifest(projectDir);
  if (manifest.players.length !== RURAL_SQUAD.length) throw new Error("manifest 与运行时 12 人名单数量不一致");
  for (const [index, person] of RURAL_SQUAD.entries()) {
    const manifestPlayer = manifest.players.find((item) => item.id === person.id);
    if (!manifestPlayer) throw new Error(`manifest 缺少角色：${person.id}`);
    if (manifestPlayer.name !== person.name || manifestPlayer.age !== person.age) {
      throw new Error(`manifest 角色资料与运行时名单不一致：${person.id}`);
    }
    if (!["front", "left", "right"].includes(manifestPlayer.headHorizontalFacing)) {
      throw new Error(`manifest 角色缺少有效 headHorizontalFacing：${person.id}`);
    }
    await validatePlayerAssetDirectory(
      personDir(person, index),
      index === 0 ? { rejectMagentaResidue: true } : undefined,
    );
  }
  return manifest;
}

function localRaceDefinition(template) {
  const next = JSON.parse(JSON.stringify(template));
  const names = {
    arm_left: "arm_left.png",
    arm_right: "arm_right.png",
    hand_left: "hand_left.png",
    hand_right: "hand_right.png",
    head_front: "head.png",
    head_back: "head_back.png",
    leg_left_knee: "knee.png",
    leg_right_knee: "knee.png",
    neck: "neck.png",
  };
  for (const [part, file] of Object.entries(names)) {
    if (!next[part] || typeof next[part] !== "object") throw new Error(`原始 race 模板缺少 ${part}`);
    next[part].name = file;
  }
  next.full_head = true;
  return next;
}

async function backupExistingTargets() {
  await fs.mkdir(backupDir, { recursive: true });
  for (let index = 1; index <= RURAL_SQUAD.length; index += 1) {
    const raceId = legacyRuralRaceId(index);
    const source = path.join(racesDir, raceId);
    if (await exists(source)) await fs.cp(source, path.join(backupDir, "races", raceId), { recursive: true });
  }
  const goldStandardRaceId = ruralRaceId(1);
  const goldStandardSource = path.join(racesDir, goldStandardRaceId);
  if (await exists(goldStandardSource)) {
    await fs.cp(
      goldStandardSource,
      path.join(backupDir, "races", goldStandardRaceId),
      { recursive: true },
    );
  }
  for (const teamId of TEAM_IDS) {
    const source = path.join(teamsDir, teamId, "team.json");
    await fs.mkdir(path.join(backupDir, "teams", teamId), { recursive: true });
    await fs.copyFile(source, path.join(backupDir, "teams", teamId, "team.json"));
    const portrait = path.join(portraitDir, `${teamId}.png`);
    await fs.mkdir(path.join(backupDir, "portraits"), { recursive: true });
    await fs.copyFile(portrait, path.join(backupDir, "portraits", `${teamId}.png`));
  }
}

async function writeStagedRaces(template, manifest) {
  const definition = JSON.stringify(localRaceDefinition(template), null, 2) + "\n";
  for (const [index, person] of RURAL_SQUAD.entries()) {
    const manifestPlayer = manifest.players.find((item) => item.id === person.id);
    const raceId = ruralRaceId(index + 1);
    const targetDir = path.join(stageDir, "races", raceId);
    await fs.mkdir(targetDir, { recursive: true });
    for (const file of RUNTIME_BODY_FILES) {
      const source = path.join(personDir(person, index), file);
      const target = path.join(targetDir, file);
      // 原骨架的默认正面朝向为向右；历史四张人头源图朝左，若不统一会在根节点
      // 翻转时产生“身体向右、脸仍像向左”的视觉错位。只翻正面头，不碰背面、
      // 锚点、尺寸、身体部件或物理数据。
      if (file === "head.png" && manifestPlayer.headHorizontalFacing === "left") {
        await sharp(source).flop().png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(target);
      } else {
        await fs.copyFile(source, target);
      }
      await validateRgbaPng(target, RURAL_ASSET_SPECS[file]);
    }
    await fs.writeFile(path.join(targetDir, "race.json"), definition);
  }
}

async function installStagedRaces() {
  for (let index = 1; index <= RURAL_SQUAD.length; index += 1) {
    const raceId = ruralRaceId(index);
    const targetDir = path.join(racesDir, raceId);
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.rename(path.join(stageDir, "races", raceId), targetDir);
  }
}

async function updateTeamRosters() {
  for (const teamId of TEAM_IDS) {
    const target = path.join(teamsDir, teamId, "team.json");
    const team = JSON.parse(await fs.readFile(target, "utf8"));
    team.players = ruralMatchPlayersForSide(teamId === "argentina" ? "red" : "blue");
    await fs.writeFile(target, JSON.stringify(team, null, 2) + "\n");
  }
}

async function updateTeamPortraits() {
  // 选队卡仍需每队一个代表头像；这里只复用本队 12 人中的不同代表，
  // 真实比赛则从完整 12 人 roster 里按位置选择球员。
  for (const [index, teamId] of TEAM_IDS.entries()) {
    const person = RURAL_SQUAD[index % RURAL_SQUAD.length];
    await fs.copyFile(
      path.join(personDir(person, index % RURAL_SQUAD.length), "portrait.png"),
      path.join(portraitDir, `${teamId}.png`),
    );
  }
}

async function main() {
  try {
    // 所有输入和暂存输出都先通过固定尺寸、RGBA、透明边界校验，运行素材最后才变更。
    const manifest = await validateBeforeMutation();
    const template = JSON.parse(await fs.readFile(path.join(racesDir, ruralRaceId(1), "race.json"), "utf8"));
    await writeStagedRaces(template, manifest);
    await backupExistingTargets();
    await installStagedRaces();
    await updateTeamRosters();
    await updateTeamPortraits();
    console.info(`[art:rural-apply] 已写入 ${RURAL_SQUAD.length} 名独立全身人物 race 和 8 支地区队名单；原素材备份：${path.relative(projectDir, backupDir)}`);
    console.info("[art:rural-apply] race.json 锚点与尺寸保持原值；请继续执行 npm run build，再在微信开发者工具重新编译。");
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("[art:rural-apply] FAIL", error && error.message || error);
  process.exitCode = 1;
});
