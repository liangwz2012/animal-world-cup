import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generated = await fs.readFile(path.join(projectDir, "generated/standalone.static.js"), "utf8");
const start = generated.indexOf("function acDriveClaim");
const end = generated.indexOf("function acApplyInput", start);
assert.ok(start > 0 && end > start, "无法从生成模块提取控制权函数");
const expression = generated.slice(start, end).replace("function acDriveClaim", "function");
const testWindow = { dispatchEvent() {} };
const playerStates = { transitionToHuman: () => ({ name: "HumanMove" }) };
const runtime = (id) => id === "players/states" ? playerStates : null;
const claim = Function("window", "console", "runtime", `return (${expression})`)(testWindow, console, runtime);

const near = { id: 2, team: null, isGoalkeeper: false, position: { x: 1, y: 0 } };
const far = { id: 3, team: null, isGoalkeeper: false, position: { x: 5, y: 0 } };
const team = { fieldPlayers: [near, far], players: [near, far] };
near.team = team;
far.team = team;
const pitch = {
  center: { x: 0, y: 0 },
  players: [near, far],
  ball: { owner: near },
};
const user = {
  team,
  player: null,
  changeTeam(next) { this.team = next; },
  takeControl(player) { this.player = player; this.takeCount = (this.takeCount || 0) + 1; },
};
const state = { wasLive: true, restartSpot: { x: 0, y: 0 }, switchCd: 0 };

claim(state, user, team, pitch, { x: 1, y: 0 }, true, false);
assert.equal(user.player, near, "已有球队但受控球员为空时必须认领持球人");
assert.equal(user.takeCount, 1);
assert.equal(testWindow.__ORIGINAL_RUNTIME_CONTROL_RECLAIM__.reason, "missing-player");

claim(state, user, team, pitch, { x: 1, y: 0 }, true, false);
assert.equal(user.takeCount, 1, "有效受控球员不得每帧重复认领");

user.player = { id: 99, team, position: { x: 9, y: 9 } };
claim(state, user, team, pitch, { x: 1, y: 0 }, true, false);
assert.equal(user.player, near, "已脱离比赛名单的旧球员引用必须自愈");
assert.equal(user.takeCount, 2);
assert.equal(testWindow.__ORIGINAL_RUNTIME_CONTROL_RECLAIM__.reason, "detached-player");

user.player = { id: 98, team, user: {}, controller: {}, position: { x: 1, y: 1 } };
pitch.players.push(user.player);
claim(state, user, team, pitch, { x: 1, y: 0 }, true, false);
assert.equal(user.player, near, "球员与用户/控制器反向绑定断裂时必须自愈");
assert.equal(testWindow.__ORIGINAL_RUNTIME_CONTROL_RECLAIM__.reason, "broken-link");

claim(state, user, team, pitch, { x: 1, y: 0 }, false, false);
assert.equal(user.team, null, "非活球阶段保持原释放语义");

console.info("[test-control-ownership-patch] PASS：空控制、失效引用、有效控制与非活球释放均正常");
