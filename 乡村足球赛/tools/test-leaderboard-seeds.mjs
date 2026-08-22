import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { mergeRegionalSeedRows, regionalSeedLeaderboard } = require("../src/data/leaderboard-seeds");

const nation = regionalSeedLeaderboard("CN:rural", "points", 8);
assert.equal(nation.scope.title, "全国乡村榜");
assert.equal(nation.rows.length, 8);
assert.equal(new Set(nation.rows.map((row) => row.path[0].code)).size, 8, "全国默认榜必须跨至少 8 个省级地区");
assert.ok(nation.rows.every((row) => row.teamLevel === "town" && row.fullTeamName.endsWith("乡亲联队")));
assert.ok(nation.rows.every((row) => !row.fullTeamName.startsWith("广东省茂名市信宜市")), "全国默认榜不得固定暴露开发者家乡");
assert.ok(nation.rows.every((row) => !/^\S+省乡亲联队$/.test(row.fullTeamName)), "全国榜不得退化为省队榜");

for (const metric of ["points", "goals", "winRate"]) {
  const board = regionalSeedLeaderboard("CN:rural", metric, 8);
  assert.equal(board.metric, metric);
  assert.ok(board.rows.every((row, index) => index === 0 || board.rows[index - 1].value >= row.value));
}
assert.equal(regionalSeedLeaderboard("CN:rural", "cleanSheets", 8).metric, "points", "非公开指标必须回落积分榜");

const guangdong = regionalSeedLeaderboard("440000:rural", "goals", 8);
assert.equal(guangdong.scope.title, "广东乡村榜");
assert.ok(guangdong.rows.some((row) => row.fullTeamName === "广东省茂名市信宜市镇隆镇乡亲联队"));
assert.ok(guangdong.rows.some((row) => row.fullTeamName === "广东省茂名市信宜市水口镇乡亲联队"));

const xinyi = regionalSeedLeaderboard("440983:rural", "points", 8);
assert.equal(xinyi.scope.title, "信宜乡村榜");
assert.equal(xinyi.rows.length, 8);

const town = regionalSeedLeaderboard("440983101000:village", "points", 8);
assert.equal(town.scope.title, "镇隆村队榜");
assert.equal(town.rows[0].fullTeamName, "广东省茂名市信宜市镇隆镇乡亲联队");

const real = [{ code: "real-village", nickname: "广东省茂名市信宜市镇隆镇天后街队", teamName: "广东省茂名市信宜市镇隆镇天后街队", value: 99, stats: { points: 99 }, self: true }];
const mixed = mergeRegionalSeedRows(real, "440983:rural", "points", 8);
assert.equal(mixed.rows.length, 8, "一支真实村队进入后必须替代一支基础乡亲联队");
assert.equal(mixed.rows.filter((row) => row.baseline).length, 7);
assert.equal(mixed.rows[0].self, true);

const eightReal = Array.from({ length: 8 }, (_, index) => ({ code: `real-${index}`, nickname: `完整地域真实队${index}`, value: 200 - index, stats: { points: 200 - index } }));
assert.equal(mergeRegionalSeedRows(eightReal, "440983:rural", "points", 8).rows.some((row) => row.baseline), false, "真实队达到展示容量后基础数据必须完全退出");

console.info("[test-leaderboard-seeds] PASS：全国跨省乡镇榜、完整地域名、三指标、我的地区筛选和真实队渐进替代正常");
