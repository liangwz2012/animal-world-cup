import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const { DEFAULT_FEATURES, PRODUCTION_CONFIG_URL } = require("../src/net/remote-config.js");

const ALLOWED_RURAL_RACES = new Set([
  // 引擎内部结构模板，不作为可选或可见球员；teams.makeSharedSpineSkins 必需。
  "skeleton",
  "rural_v2_01",
  ...Array.from({ length: 14 }, (_, index) => `rural_${String(index + 1).padStart(2, "0")}`),
]);
const LEGACY_VISIBLE_BRAND = new RegExp([
  ["ANIMAL", "CUP"].join("\\s+"),
  ["动物", "足球赛"].join(""),
  ["动物", "世界杯"].join(""),
].join("|"), "i");
const LEGACY_INTERNAL_BRAND = new RegExp([
  ["__ANIMAL", "FOOTBALL"].join("_"),
  ["__animal", "Cup"].join(""),
  ["animal", "-football:"].join(""),
  ["animal", "Cup\\.controls"].join(""),
].join("|"));

async function read(relative) {
  return fs.readFile(path.join(projectDir, relative), "utf8");
}

async function exists(relative) {
  try { await fs.access(path.join(projectDir, relative)); return true; } catch { return false; }
}

async function textFiles(root) {
  const result = [];
  async function visit(current) {
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && /\.(?:js|mjs|cjs|json|md|txt|xml|wxml|wxss)$/i.test(entry.name)) result.push(target);
    }
  }
  await visit(path.join(projectDir, root));
  return result;
}

async function main() {
  const blockers = [];
  const warnings = [];
  const [projectSource, appSource, shellSource, optionsSource, friendServiceSource] = await Promise.all([
    read("project.config.json"),
    read("src/app/main.js"),
    read("src/ui/game-shell.js"),
    read("src/data/game-options.js"),
    read("src/net/friend-service-config.js"),
  ]);
  const project = JSON.parse(projectSource);
  if (!/^wx[a-f0-9]{16}$/i.test(String(project.appid || ""))) blockers.push("未配置有效的正式小游戏 AppID");
  if (project.compileType !== "game") blockers.push("compileType 必须为 game");
  if (project.isGameTourist === true) blockers.push("提审项目不得使用游客小游戏模式");
  if (!await exists("package-lock.json")) blockers.push("缺少 package-lock.json，生产依赖无法复现");

  const releaseCode = `${appSource}\n${shellSource}\n${optionsSource}`;
  for (const [needle, message] of [
    ["showMatchmaking", "仍包含真人匹配页面"],
    ['mode: "online"', "仍包含未接通的 online 游戏模式"],
    ["正在匹配真人对手", "仍包含真人匹配文案"],
    ["暂未匹配到真人", "仍包含未接通的匹配兜底"],
  ]) {
    if (releaseCode.includes(needle)) blockers.push(message);
  }

  if (!/^https:\/\//.test(PRODUCTION_CONFIG_URL) || /localhost|127\.0\.0\.1|\[?::1\]?/.test(PRODUCTION_CONFIG_URL)) {
    blockers.push("远程开关地址必须是非本机 HTTPS 地址");
  }
  if (DEFAULT_FEATURES.leaderboard.enabled || DEFAULT_FEATURES.friend.enabled || DEFAULT_FEATURES.monetization.enabled) {
    blockers.push("首发安全默认值必须关闭排行榜、好友对战和广告开关");
  }

  const entryFlagMatch = friendServiceSource.match(/const FRIEND_ENTRY_ENABLED = (true|false)/);
  const friendEntryEnabled = entryFlagMatch ? entryFlagMatch[1] === "true" : true;
  if (friendEntryEnabled) {
    const endpointMatch = friendServiceSource.match(/const PRODUCTION_ROOM_WSS_URL = "([^"]*)"/);
    const endpoint = endpointMatch && endpointMatch[1] || "";
    if (!/^wss:\/\//.test(endpoint) || /localhost|127\.0\.0\.1|\[?::1\]?/.test(endpoint)) {
      blockers.push("好友对战入口已展示，但正式 WSS 地址无效");
    }
  }

  for (const legacyPath of [
    "source-assets/public/animal-cup",
    "source-assets/cocos/animal_football",
    "runtime-assets/animal-cup",
  ]) {
    if (await exists(legacyPath)) blockers.push(`仍保留旧品牌资源目录：${legacyPath}`);
  }

  const raceDir = path.join(projectDir, "source-assets/public/match-runtime-min/data/player/races");
  const raceEntries = (await fs.readdir(raceDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const unexpectedRaces = raceEntries.filter((name) => !ALLOWED_RURAL_RACES.has(name));
  const missingRaces = [...ALLOWED_RURAL_RACES].filter((name) => !raceEntries.includes(name));
  if (unexpectedRaces.length) blockers.push(`正式角色目录仍有旧角色：${unexpectedRaces.join("、")}`);
  if (missingRaces.length) blockers.push(`乡村角色资源不完整：${missingRaces.join("、")}`);
  for (const teamName of ["argentina", "brazil", "england", "france", "germany", "portugal", "spain", "usa"]) {
    const team = JSON.parse(await read(`source-assets/public/match-runtime-min/data/teams/${teamName}/team.json`));
    if ((team.players || []).some((player) => player && player.race === "skeleton")) {
      blockers.push(`结构模板 skeleton 不得作为可见球员：${teamName}`);
    }
  }

  const deployableFiles = (await Promise.all([
    textFiles("src"),
    textFiles("generated"),
    textFiles("runtime-assets"),
    textFiles("shell-assets"),
  ])).flat();
  deployableFiles.push(path.join(projectDir, "game.js"), path.join(projectDir, "game.json"), path.join(projectDir, "project.config.json"));
  for (const file of deployableFiles) {
    const source = await fs.readFile(file, "utf8").catch(() => "");
    const relative = path.relative(projectDir, file);
    if (LEGACY_VISIBLE_BRAND.test(source)) {
      blockers.push(`可上传代码仍含旧产品可见品牌：${relative}`);
    }
    if (LEGACY_INTERNAL_BRAND.test(source)) {
      blockers.push(`可上传代码仍含旧项目内部标识：${relative}`);
    }
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKID[A-Za-z0-9]{12,}|\bsk-[A-Za-z0-9_-]{20,}/.test(source)) {
      blockers.push(`可上传文件疑似包含凭据：${relative}`);
    }
  }

  const complianceSource = await read("src/data/release-compliance.js");
  if (/copyrightOwner:\s*"[^"]+"|approvalNumber:\s*"[^"]+"|miniProgramFilingNumber:\s*"[^"]+"/.test(complianceSource)) {
    warnings.push("源码内仍填写了可选资质展示字段；正式审核资料应以微信公众平台后台为准");
  }

  if (blockers.length) {
    console.error("[release-check] BLOCKED：当前版本不得上传提审");
    for (const blocker of [...new Set(blockers)]) console.error(`- ${blocker}`);
    process.exitCode = 1;
    return;
  }

  console.info("[release-check] PASS：项目身份、离线默认、旧资源清理、角色白名单、依赖锁定和客户端凭据扫描通过");
  for (const warning of warnings) console.warn(`[release-check] WARN：${warning}`);
  console.info("[release-check] 人工闸门：微信后台类目/备案/隐私指引、合法域名，以及排行榜和好友对战双真机验收仍须逐项确认；这些资料不要求重复写入源码。");
}

main().catch((error) => {
  console.error("[release-check] FAIL", error);
  process.exitCode = 1;
});
