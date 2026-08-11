import test from "node:test";
import assert from "node:assert/strict";

import { createMatch, matchSnapshot, stepMatch } from "../src/core/match.js";
import { MATCH_PHASE, TICK_HZ } from "../src/core/constants.js";

function runMatch(seconds, options = {}) {
  const match = createMatch({ seed: 424242, formatId: "5v5", halfSeconds: 40, ...options });
  const frames = [];
  for (let i = 0; i < seconds * TICK_HZ; i += 1) {
    stepMatch(match, {});
    if (i % 30 === 0) frames.push(matchSnapshot(match));
  }
  return { match, frames };
}

// 死球（开球、进球、界外球、任意球）不走比赛时钟，所以真实耗时长于两个半场之和
test("比赛核心可以跑完整整一局而不抛异常", () => {
  const { match } = runMatch(150);
  assert.equal(match.finished, true);
  assert.equal(match.phase, MATCH_PHASE.FULL_TIME);
  assert.ok(match.time >= 80);
});

test("同一 seed 产生逐帧一致的比赛（可回放/可联机）", () => {
  const a = runMatch(30);
  const b = runMatch(30);
  assert.deepEqual(a.frames, b.frames);
  assert.deepEqual(a.match.score, b.match.score);
});

test("不同 seed 会产生不同的比赛过程", () => {
  const a = runMatch(30);
  const b = runMatch(30, { seed: 99 });
  assert.notDeepEqual(a.frames, b.frames);
});

test("球始终在场地范围内且不会飞到地下", () => {
  const { match } = runMatch(60);
  assert.ok(match.ball.y >= 0);
  assert.ok(Math.abs(match.ball.x) < match.format.pitch.length);
  assert.ok(Math.abs(match.ball.z) < match.format.pitch.width);
});

test("球员不会重叠成一坨", () => {
  const match = createMatch({ seed: 7, formatId: "7v7", halfSeconds: 30 });
  for (let i = 0; i < 60 * TICK_HZ; i += 1) {
    stepMatch(match, {});
    if (i % 97 !== 0) continue;
    for (let a = 0; a < match.players.length; a += 1) {
      for (let b = a + 1; b < match.players.length; b += 1) {
        const d = Math.hypot(match.players[a].x - match.players[b].x, match.players[a].z - match.players[b].z);
        assert.ok(d > 0.5, `球员 ${a} 与 ${b} 距离 ${d.toFixed(3)} 过近`);
      }
    }
  }
});

test("一局比赛会自然产生射门、界外球和至少一次死球重开", () => {
  const match = createMatch({ seed: 31337, formatId: "5v5", halfSeconds: 90 });
  const seen = new Set();
  for (let i = 0; i < 180 * TICK_HZ; i += 1) {
    stepMatch(match, {});
    for (const event of match.events) seen.add(event.type);
  }
  assert.ok(seen.has("shot"), "应当出现射门");
  assert.ok(seen.has("pass"), "应当出现传球");
  assert.ok(seen.has("set-piece"), "应当出现死球重开");
});

test("玩家输入能够改变比赛走向", () => {
  const base = createMatch({ seed: 5150, formatId: "5v5", halfSeconds: 60 });
  const driven = createMatch({ seed: 5150, formatId: "5v5", halfSeconds: 60 });
  for (let i = 0; i < 40 * TICK_HZ; i += 1) {
    stepMatch(base, {});
    stepMatch(driven, {
      moveX: 1,
      moveZ: Math.sin(i / 20) * 0.6,
      sprint: i % 60 < 30,
      shootPower: 0.9,
      actions: { shoot: i % 150 === 0, pass: i % 91 === 0 },
    });
  }
  assert.notDeepEqual(matchSnapshot(base), matchSnapshot(driven));
});

test("体力会随冲刺下降", () => {
  const match = createMatch({ seed: 11, formatId: "5v5", halfSeconds: 90 });
  const controlled = match.players.find((p) => p.id === match.controlledId);
  const before = controlled.stamina;
  for (let i = 0; i < 25 * TICK_HZ; i += 1) {
    stepMatch(match, { moveX: 1, moveZ: 0, sprint: true, actions: {} });
  }
  assert.ok(controlled.stamina < before, `体力应下降：${before} -> ${controlled.stamina}`);
});
