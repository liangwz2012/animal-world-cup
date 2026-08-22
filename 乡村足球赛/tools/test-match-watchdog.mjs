import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createMatchWatchdog } = require("../src/data/match-watchdog.js");

function makePlayer(id, x, y, extra) {
  return Object.assign({
    id,
    isGoalkeeper: false,
    position: { x, y },
    states: { changed: [], change(state) { this.changed.push(state); } },
  }, extra || {});
}

function makeGame(players, overrides) {
  return {
    pitch: Object.assign({
      matchStarted: true,
      ballOutOfPlay: false,
      paused: false,
      redTeam: { allPlayers: players.slice(0, 2) },
      blueTeam: { allPlayers: players.slice(2) },
    }, overrides || {}),
  };
}

const ReturnHome = { name: "ReturnHome" };
let forceAICalls = [];
const globals = { forceAI: (player) => forceAICalls.push(player.id) };
const states = { ReturnHome };

function setup(players, opts) {
  forceAICalls = [];
  const logs = [];
  const watchdog = createMatchWatchdog(Object.assign({
    staticSeconds: 20,
    minMoveMeters: 0.5,
    intervalMs: 1000,
    getPlayerGlobals: () => globals,
    getPlayerStates: () => states,
    getUsers: () => ({ list: (opts && opts.users) || [] }),
    logger: { warn: (msg) => logs.push(String(msg)) },
  }, opts || {}));
  return { watchdog, logs };
}

// 1) 健康移动：全员持续位移，始终不触发
{
  const players = [makePlayer(1, 0, 0), makePlayer(2, 5, 5), makePlayer(7, 9, 9), makePlayer(8, 1, 1)];
  const game = makeGame(players);
  const wd = createMatchWatchdog({
    staticSeconds: 20, minMoveMeters: 0.5,
    getGame: () => game,
    getPlayerGlobals: () => globals, getPlayerStates: () => states, getUsers: () => ({ list: [] }),
    logger: { warn() {} },
  });
  for (let t = 0; t <= 60; t += 1) {
    players.forEach((player, index) => { player.position.x = t + index; });
    wd.tick(t * 1000);
  }
  assert.equal(forceAICalls.length, 0, "持续移动不得触发恢复");
}

// 2) 静止超阈值：触发一次 forceAI + ReturnHome
{
  forceAICalls = [];
  const frozen = makePlayer(4, 3, 3);
  const mates = [makePlayer(2, 9, 9), makePlayer(7, 8, 8), makePlayer(8, 0, 0)];
  const game = makeGame([frozen, ...mates]);
  const wd = createMatchWatchdog({
    staticSeconds: 20, minMoveMeters: 0.5,
    getGame: () => game,
    getPlayerGlobals: () => globals, getPlayerStates: () => states, getUsers: () => ({ list: [] }),
    logger: { warn() {} },
  });
  for (let t = 0; t <= 25; t += 1) {
    mates.forEach((player, index) => { player.position.x = 9 + t + index; });
    wd.tick(t * 1000);
  }
  assert.deepEqual(forceAICalls, [4], "静止 20s 必须恢复一次且只针对静止者");
  assert.equal(frozen.states.changed.length, 1);
  assert.equal(frozen.states.changed[0], ReturnHome);
}

// 3) 阈值内静止：不触发
{
  forceAICalls = [];
  const frozen = makePlayer(4, 3, 3);
  const mates = [makePlayer(2, 9, 9), makePlayer(7, 8, 8), makePlayer(8, 0, 0)];
  const game = makeGame([frozen, ...mates]);
  const wd = createMatchWatchdog({
    staticSeconds: 20, minMoveMeters: 0.5,
    getGame: () => game,
    getPlayerGlobals: () => globals, getPlayerStates: () => states, getUsers: () => ({ list: [] }),
    logger: { warn() {} },
  });
  for (let t = 0; t <= 12; t += 1) {
    mates.forEach((player, index) => { player.position.x = 9 + t + index; });
    wd.tick(t * 1000);
  }
  assert.equal(forceAICalls.length, 0, "12s 静止不得触发");
}

// 4) 门将被豁免，人类操控球员被豁免
{
  forceAICalls = [];
  const gk = makePlayer(0, 0, 0, { isGoalkeeper: true });
  const human = makePlayer(4, 3, 3);
  const mates = [makePlayer(7, 8, 8), makePlayer(8, 0, 0)];
  const game = makeGame([gk, human, ...mates]);
  const wd = createMatchWatchdog({
    staticSeconds: 20, minMoveMeters: 0.5,
    getGame: () => game,
    getPlayerGlobals: () => globals, getPlayerStates: () => states,
    getUsers: () => ({ list: [{ player: human }] }),
    logger: { warn() {} },
  });
  for (let t = 0; t <= 30; t += 1) {
    mates.forEach((player, index) => { player.position.x = 8 + t + index; });
    wd.tick(t * 1000);
  }
  assert.equal(forceAICalls.length, 0, "门将与人类操控球员不得触发");
}

// 5) 非活球（出界/暂停/未开赛）不触发
{
  forceAICalls = [];
  const frozen = makePlayer(4, 3, 3);
  const mates = [makePlayer(2, 9, 9), makePlayer(7, 8, 8), makePlayer(8, 0, 0)];
  const game = makeGame([frozen, ...mates], { ballOutOfPlay: true });
  const wd = createMatchWatchdog({
    staticSeconds: 20, minMoveMeters: 0.5,
    getGame: () => game,
    getPlayerGlobals: () => globals, getPlayerStates: () => states, getUsers: () => ({ list: [] }),
    logger: { warn() {} },
  });
  for (let t = 0; t <= 30; t += 1) {
    mates.forEach((player, index) => { player.position.x = 9 + t + index; });
    wd.tick(t * 1000);
  }
  assert.equal(forceAICalls.length, 0, "非活球状态不得触发");
}

// 6) 单球员单场恢复上限 3 次
{
  forceAICalls = [];
  const frozen = makePlayer(4, 3, 3);
  const mates = [makePlayer(2, 9, 9), makePlayer(7, 8, 8), makePlayer(8, 0, 0)];
  const game = makeGame([frozen, ...mates]);
  const wd = createMatchWatchdog({
    staticSeconds: 5, minMoveMeters: 0.5, maxRecoveriesPerPlayer: 3,
    getGame: () => game,
    getPlayerGlobals: () => globals, getPlayerStates: () => states, getUsers: () => ({ list: [] }),
    logger: { warn() {} },
  });
  for (let t = 0; t <= 60; t += 1) {
    mates.forEach((player, index) => { player.position.x = 9 + t + index; });
    wd.tick(t * 1000);
  }
  assert.equal(forceAICalls.length, 3, "超过上限后不再恢复（只留日志）");
}

console.info("[test-match-watchdog] PASS：阈值触发、门将/人类豁免、非活球豁免与单场恢复上限均正常");
