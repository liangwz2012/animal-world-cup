import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  TEAMS,
  FORMATIONS,
  DIFFICULTIES,
  TIMES,
  defaults,
  normalizeConfig,
  formation,
  cycle,
} = require("../src/data/game-options.js");

assert.equal(TEAMS.length, 8, "必须保留网页版 8 支球队");
assert.equal(FORMATIONS.length, 6, "必须保留网页版 6 套七人制阵型");
for (const item of FORMATIONS) assert.equal(item.spots.length, 6, `${item.name} 必须有 6 名非门将位置`);
assert.deepEqual(DIFFICULTIES.map((item) => item.value), [0, 1, 2]);
assert.deepEqual(TIMES.map((item) => item.value), [4, 6, 10]);

const initial = defaults();
assert.equal(initial.redTeam, "argentina");
assert.equal(initial.blueTeam, "portugal");
assert.notEqual(initial.redTeam, initial.blueTeam);

const normalized = normalizeConfig({ redTeam: "england", blueTeam: "england", ai: 99, time: 99 });
assert.equal(normalized.redTeam, "england");
assert.notEqual(normalized.blueTeam, normalized.redTeam, "双方球队不得相同");
assert.equal(normalized.ai, 0);
assert.equal(normalized.time, 4);
assert.equal(normalizeConfig({ mode: "online" }).mode, "ai", "首发审核包不得启用未上线的真人匹配模式");
assert.equal(normalizeConfig({ mode: "friend" }).mode, "friend", "好友邀请必须保留 friend 模式");
assert.equal(normalizeConfig({ roomId: "  room-1  " }).roomId, "room-1");
assert.equal(formation("2-3-1").name, "2-3-1");
assert.equal(cycle(FORMATIONS, "2-3-1", "name", 1), "3-2-1");
assert.equal(cycle(FORMATIONS, "2-3-1", "name", -1), "2-1-3");

console.info("[test:game-options] PASS：8 队、阵型、难度、时长、同队互斥与循环选择正常");
