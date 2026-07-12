import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const compliance = require("../src/data/release-compliance.js");

const requiredQualifications = {
  copyrightOwner: "著作权人",
  publishingServiceUnit: "出版服务单位",
  approvalNumber: "批准文号",
  publicationNumber: "出版物号",
  softwareCopyrightRegistrationNumber: "软件著作权登记号",
  miniProgramFilingNumber: "小程序备案号",
};

async function read(relative) {
  return fs.readFile(path.join(projectDir, relative), "utf8");
}

async function main() {
  const blockers = [];
  for (const [key, label] of Object.entries(requiredQualifications)) {
    if (!String(compliance[key] || "").trim()) blockers.push(`未配置${label}（release-compliance.js: ${key}）`);
  }

  const [projectSource, appSource, shellSource, optionsSource, friendServiceSource] = await Promise.all([
    read("project.config.json"),
    read("src/app/main.js"),
    read("src/ui/game-shell.js"),
    read("src/data/game-options.js"),
    read("src/net/friend-service-config.js"),
  ]);
  const project = JSON.parse(projectSource);
  if (!project.appid || project.appid === "touristappid") blockers.push("未配置正式小游戏 AppID");
  if (project.compileType !== "game") blockers.push("compileType 必须为 game");
  if (project.isGameTourist === true) blockers.push("提审项目不得使用游客小游戏模式");
  const releaseCode = `${appSource}\n${shellSource}\n${optionsSource}`;
  const forbiddenReleaseFeatures = [
    ["showMatchmaking", "仍包含真人匹配页面"],
    ['mode: "online"', "仍包含 online 游戏模式"],
    ["正在匹配真人对手", "仍包含真人匹配文案"],
    ["暂未匹配到真人", "仍包含未接通的匹配兜底"],
  ];
  for (const [needle, message] of forbiddenReleaseFeatures) {
    if (releaseCode.includes(needle)) blockers.push(message);
  }
  if (shellSource.includes("好友对战")) {
    const endpointMatch = friendServiceSource.match(/const PRODUCTION_ROOM_WSS_URL = "([^"]*)"/);
    const endpoint = endpointMatch && endpointMatch[1] || "";
    if (!/^wss:\/\//.test(endpoint)) blockers.push("好友对战已展示，但未配置正式 wss:// 房间服务地址");
    if (/localhost|127\.0\.0\.1|\[?::1\]?/.test(endpoint)) blockers.push("正式好友对战不得使用本机房间服务地址");
  }

  if (blockers.length) {
    console.error("[release-check] BLOCKED：当前版本不得上传提审");
    for (const blocker of blockers) console.error(`- ${blocker}`);
    console.error("[release-check] 请填写真实资质，且必须与微信公众平台登记内容逐字一致；不得使用占位或编造信息。");
    process.exitCode = 1;
    return;
  }

  console.info("[release-check] PASS：代码、包体、首发功能和本地资质字段通过提审硬检查");
  console.info("[release-check] 仍需在微信公众平台人工确认：游戏类目、主体资质、小程序备案、软著/授权链、隐私保护指引与审核说明一致。");
}

main().catch((error) => {
  console.error("[release-check] FAIL", error);
  process.exitCode = 1;
});
