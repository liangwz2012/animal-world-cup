import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ROUND_COUNT, buildRoundRobin, createSeasonJourney } = require("../src/data/season-journey.js");

const teams = ["england", "france", "germany", "spain", "portugal", "brazil", "argentina", "usa"];
const schedule = buildRoundRobin(teams.slice(0, 6));
assert.equal(schedule.length, ROUND_COUNT, "六支队伍必须生成五轮赛程");
const uniquePairs = new Set(schedule.flat().map((pair) => pair.slice().sort().join(":")));
assert.equal(uniquePairs.size, 15, "循环赛中的每一对球队只能相遇一次");

const storage = new Map();
const wxApi = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
};
const season = createSeasonJourney({ wxApi });

let prepared = season.prepareMatch({
  teamId: "argentina",
  teamIds: teams,
  redFormation: "2-3-1",
  blueFormation: "3-2-1",
});
assert.equal(prepared.journeyMode, "season");
assert.equal(prepared.redTeam, "argentina", "赛季开始后必须锁定玩家首选球队");
assert.notEqual(prepared.redTeam, prepared.blueTeam, "赛季对手不能与玩家球队相同");
assert.equal(prepared.matchId, "season-1-round-1");

let recorded = season.recordMatch({ score: [2, 1] }, prepared);
assert.equal(recorded.accepted, true, "合法终场赛果必须进入赛季");
assert.equal(season.snapshot().completedRounds, 1);
assert.equal(season.snapshot().stats.points, 3, "胜利必须为赛季增加三分");
assert.equal(season.recordMatch({ score: [2, 1] }, prepared).accepted, false, "重复回调不能重复结算赛季");

for (let index = 1; index < ROUND_COUNT; index += 1) {
  prepared = season.prepareMatch({ teamId: "england", teamIds: teams, redFormation: "2-3-1", blueFormation: "3-2-1" });
  recorded = season.recordMatch({ score: index === 2 ? [1, 1] : [1, 0] }, prepared);
  assert.equal(recorded.accepted, true, `第 ${index + 1} 轮必须能正确结算`);
}
const finished = season.snapshot();
assert.equal(finished.complete, true, "五场完成后赛季必须结算");
assert.equal(finished.standings.length, 6, "赛季积分榜必须包含六队");
assert.ok(finished.rank >= 1 && finished.rank <= 6, "赛季名次必须落在有效范围");
assert.ok(finished.bestRank >= 1 && finished.bestRank <= 6, "完赛时必须保存历史最佳名次");
assert.equal(season.startNextSeason().accepted, true, "完赛后必须可以开启下一赛季");
assert.equal(season.snapshot().completedRounds, 0, "下一赛季必须从第一场重新开始");

console.info("[test:season-journey] PASS：赛程、积分、结算与续赛正常");
