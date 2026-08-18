import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { challengeForDate, createDailyChallenge, isBetter } = require("../src/data/daily-challenge.js");

assert.deepEqual(challengeForDate("2026-07-29"), challengeForDate("2026-07-29"), "同一天的挑战规则必须稳定");
assert.notEqual(challengeForDate("2026-07-29").id, challengeForDate("2026-07-30").id, "跨天必须切换挑战编号");
assert.equal(isBetter({ complete: true, difference: 1, goals: 2, elapsedMs: 100, achievedAt: 2 }, { complete: false, difference: 3, goals: 5, elapsedMs: 1, achievedAt: 1 }), true, "完成目标优先于未完成的高比分");

const storage = new Map();
let day = "2026-07-29";
let now = 1_750_000_000_000;
const daily = createDailyChallenge({
  wxApi: { getStorageSync(key) { return storage.get(key); }, setStorageSync(key, value) { storage.set(key, value); } },
  now: () => now,
  dayKey: () => day,
});

let prepared = daily.prepareMatch();
assert.equal(prepared.journeyMode, "daily");
assert.equal(prepared.challengeId, "daily-2026-07-29");
let result = daily.recordMatch({ score: [2, 1] }, prepared, { elapsedMs: 42000 });
assert.equal(result.accepted, true, "每日挑战合法赛果必须入账");
assert.equal(result.improved, true, "第一场必须成为当日最佳成绩");

prepared = daily.prepareMatch();
now += 1000;
result = daily.recordMatch({ score: [2, 1] }, prepared, { elapsedMs: 52000 });
assert.equal(result.improved, false, "同分更慢的成绩不能覆盖当日最佳");

prepared = daily.prepareMatch();
now += 1000;
result = daily.recordMatch({ score: [3, 1] }, prepared, { elapsedMs: 60000 });
assert.equal(result.improved, true, "更高净胜球必须覆盖当日最佳");
assert.equal(daily.snapshot().best.difference, 2);
assert.equal(daily.recordMatch({ score: [3, 1] }, prepared, { elapsedMs: 60000 }).accepted, false, "同一尝试不能重复结算");

day = "2026-07-30";
assert.equal(daily.snapshot().best, null, "跨天后当天成绩必须从空开始");
assert.equal(daily.snapshot().history.length, 1, "未开始新挑战时保留昨天历史但不虚构新记录");
daily.prepareMatch();
assert.equal(daily.snapshot().history.length, 2, "开始新一天挑战后应保留两天历史");

console.info("[test:daily-challenge] PASS：日期、最佳成绩与跨日切换正常");
