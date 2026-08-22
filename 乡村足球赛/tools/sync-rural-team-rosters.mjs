import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ruralMatchPlayersForSide } = require("../src/data/rural-squad.js");
const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const roots = [
  path.join(projectDir, "source-assets", "public", "match-runtime-min"),
  path.join(projectDir, "runtime-assets", "match-runtime-min"),
];
const teamIds = ["argentina", "brazil", "england", "france", "germany", "portugal", "spain", "usa"];

for (const root of roots) {
  for (const teamId of teamIds) {
    const target = path.join(root, "data", "teams", teamId, "team.json");
    const team = JSON.parse(await fs.readFile(target, "utf8"));
    team.players = ruralMatchPlayersForSide(teamId === "argentina" ? "red" : "blue");
    await fs.writeFile(target, `${JSON.stringify(team, null, 2)}\n`);
  }
}

console.info("[sync-rural-team-rosters] PASS：主队 7 人、客队 7 人与选队页人物已对齐");
