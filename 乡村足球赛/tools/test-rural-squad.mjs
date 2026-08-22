import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  RURAL_GOLD_STANDARD_RACE_ID,
  RURAL_SQUAD,
  legacyRuralRaceId,
  ruralRaceId,
  ruralMatchPlayersForSide,
  ruralPlayers,
  ruralPlayersForSide,
} = require("../src/data/rural-squad.js");

assert.equal(RURAL_SQUAD.length, 14, "乡村队必须是完整 14 人名单（7v7 双方零撞脸）");
assert.equal(new Set(RURAL_SQUAD.map((player) => player.id)).size, 14, "角色 id 必须唯一");
assert.equal(new Set(RURAL_SQUAD.map((player) => player.number)).size, 14, "号码必须唯一");
assert.deepEqual(ruralPlayers().map((player) => player.race), [
  "rural_v2_01", "rural_02", "rural_03", "rural_04", "rural_05", "rural_06",
  "rural_07", "rural_08", "rural_09", "rural_10", "rural_11", "rural_12",
  "rural_13", "rural_14",
]);
assert.equal(RURAL_GOLD_STANDARD_RACE_ID, "rural_v2_01");
assert.equal(legacyRuralRaceId(1), "rural_01", "旧队长 race 必须继续保留用于一键回退");
assert.equal(ruralRaceId(0), "");
assert.equal(ruralRaceId(15), "");
assert.deepEqual(new Set(RURAL_SQUAD.map((player) => player.role)), new Set(["G", "D", "M", "A"]));
assert.ok(RURAL_SQUAD.every((player) => typeof player.bodyProfile === "string" && player.bodyProfile), "每名角色必须声明体型预设");
assert.ok(new Set(RURAL_SQUAD.slice(0, 7).map((player) => player.bodyProfile)).size >= 5, "首发七人必须至少覆盖 5 种体型");
const redLineup = ruralPlayersForSide("red");
const blueLineup = ruralPlayersForSide("blue");
assert.equal(redLineup.length, 6);
assert.equal(blueLineup.length, 6);
assert.equal(new Set([...redLineup, ...blueLineup].map((player) => player.id)).size, 12, "主客 6+6 必须完整覆盖12名不同角色");
assert.ok(redLineup.some((player) => player.role === "G") && blueLineup.some((player) => player.role === "G"), "主客队都必须有门将");
assert.ok(redLineup.some((player) => player.role === "D") && blueLineup.some((player) => player.role === "D"), "主客队都必须有后卫");
assert.ok(redLineup.some((player) => player.role === "M") && blueLineup.some((player) => player.role === "M"), "主客队都必须有中场");
assert.ok(redLineup.some((player) => player.role === "A") && blueLineup.some((player) => player.role === "A"), "主客队都必须有前锋");
assert.equal(redLineup[0].id, "graduate-forward", "返乡大学生必须是选队页主队第一视觉主角");
assert.ok(redLineup.some((player) => player.id === "shopkeeper-midfielder" && player.vocation === "小卖部老板"), "小卖部老板必须保留在主队选队人物中");
assert.equal(redLineup[0].age, undefined, "对外比赛配置不重复携带年龄隐私字段");
assert.equal(RURAL_SQUAD.find((player) => player.id === "graduate-forward").age, 30, "返乡大学生年龄应约 30 岁");
assert.equal(RURAL_SQUAD.find((player) => player.id === "shopkeeper-midfielder").vocation, "小卖部老板");
const redMatch = ruralMatchPlayersForSide("red");
const blueMatch = ruralMatchPlayersForSide("blue");
assert.equal(redMatch.length, 7);
assert.equal(blueMatch.length, 7);
assert.equal(new Set([...redMatch, ...blueMatch].map((player) => player.id)).size, 14, "比赛双方 7+7 必须覆盖全部不同人物");
assert.ok(redLineup.every((player) => redMatch.some((actual) => actual.id === player.id)), "选队页主队人物必须全部出现在真实主队比赛名单");
assert.ok(blueLineup.every((player) => blueMatch.some((actual) => actual.id === player.id)), "选队页客队人物必须全部出现在真实客队比赛名单");
const roles = (players) => players.reduce((counts, player) => Object.assign(counts, { [player.role]: (counts[player.role] || 0) + 1 }), {});
assert.deepEqual(roles(redMatch), { G: 1, D: 2, M: 3, A: 1 }, "主队 2-3-1 首发位置必须完整");
assert.deepEqual(roles(blueMatch), { G: 1, D: 3, M: 2, A: 1 }, "客队 3-2-1 首发位置必须完整");
const averageAge = RURAL_SQUAD.reduce((sum, player) => sum + player.age, 0) / RURAL_SQUAD.length;
assert.equal(Number(averageAge.toFixed(2)), 35);
assert.ok(averageAge >= 28 && averageAge <= 35, "常规村队年龄均值应保持在 28–35 岁");

console.log("[test-rural-squad] PASS：14 名乡村队员、号码、年龄结构、体型和运行时 race 映射完整");
