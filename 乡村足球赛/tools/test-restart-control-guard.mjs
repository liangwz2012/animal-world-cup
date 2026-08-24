import assert from "node:assert/strict";
import fs from "node:fs/promises";

const generated = await fs.readFile(new URL("../generated/standalone.static.js", import.meta.url), "utf8");
const start = generated.indexOf("function acAutoSwitch");
const end = generated.indexOf("function createPlayPhase", start);
assert.ok(start > 0 && end > start, "无法从生成模块提取自动切人函数");
const expression = generated.slice(start, end).replace("function acAutoSwitch", "function");
const testWindow = {};
const playerStates = {
  transitionToHuman(player) { return player.restartAction ? null : { name: "HumanMove" }; },
};
const runtime = (id) => id === "players/states" ? playerStates : null;
const autoSwitch = Function("window", "console", "runtime", `return (${expression})`)(testWindow, console, runtime);

const current = { id: 1, hasBall: false, isGoalkeeper: false, position: { x: 8, y: 0 } };
const cornerTaker = { id: 2, hasBall: false, isGoalkeeper: false, restartAction: true, position: { x: 0, y: 0 }, states: { current: { name: "Lob" } } };
const team = { fieldPlayers: [current, cornerTaker] };
const user = {
  player: current,
  team,
  controller: { togglePlayer: { isActive: false } },
  takeControl(player) { this.player = player; this.takeCount = (this.takeCount || 0) + 1; },
};
const pitch = { ball: { position: { x: 0, y: 0 } } };
const state = { switchCd: 0 };

autoSwitch(state, user, pitch, true, 0.1);
assert.equal(user.player, current, "角球Lob/Pass完成前不得被自动切人打断");
assert.equal(user.takeCount || 0, 0);
assert.equal(testWindow.__ORIGINAL_RUNTIME_RESTART_SWITCH_BLOCKED__.state, "Lob");

cornerTaker.restartAction = false;
autoSwitch(state, user, pitch, true, 0.1);
assert.equal(user.player, cornerTaker, "重开球动作完成后必须恢复正常自动切人");
assert.equal(user.takeCount, 1);

console.info("[test-restart-control-guard] PASS：角球/界外球动作保护与完成后自动切人恢复正常");
