import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { mergeRegionalSeedRows, regionalSeedLeaderboard } = require("../src/data/leaderboard-seeds.js");

const provinces = regionalSeedLeaderboard("CN:province", "points", 8);
assert.equal(provinces.scope.title, "全国省队榜");
assert.equal(provinces.rows.length, 8);
assert.ok(provinces.rows.every((row, index) => row.rank === index + 1 && row.value > 0 && row.nickname));

const cities = regionalSeedLeaderboard("440000:city", "goals", 32);
assert.equal(cities.scope.title, "广东城市榜");
assert.ok(cities.rows.length >= 20);
assert.ok(cities.rows.some((row) => row.nickname === "广州"));
assert.ok(cities.rows.some((row) => row.nickname === "茂名"));

const towns = regionalSeedLeaderboard("440983:town", "points", 8);
assert.equal(towns.scope.title, "信宜乡镇榜");
assert.ok(towns.rows.some((row) => row.nickname === "镇隆"));
assert.ok(towns.rows.some((row) => row.nickname === "水口"));

const real = [{ code: "440100", nickname: "广州", teamName: "广州", value: 99, stats: { points: 99 }, self: true }];
const mixed = mergeRegionalSeedRows(real, "440000:city", "points", 8);
assert.equal(mixed.rows.length, 8, "一支真实地区队进入后必须替代一支基础队伍");
assert.equal(mixed.rows.filter((row) => row.baseline).length, 7);
assert.equal(mixed.rows[0].nickname, "广州");
assert.equal(mixed.rows[0].self, true);

const eightReal = Array.from({ length: 8 }, (_, index) => ({ code: `real-${index}`, nickname: `真实队${index}`, value: 200 - index, stats: { points: 200 - index } }));
assert.equal(mergeRegionalSeedRows(eightReal, "440000:city", "points", 8).rows.some((row) => row.baseline), false, "真实队伍达到展示容量后必须完全替代基础数据");

console.info("[test-leaderboard-seeds] PASS：省市县乡基础榜、全指标排序和真实队渐进替代正常");
