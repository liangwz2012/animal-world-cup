import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { STORAGE_KEY, MIN_RANK_MATCHES, createLeaderboard } = require("../src/data/leaderboard");
const { createRegionalTeam } = require("../src/data/region-league");

function makeWx() {
  const store = new Map();
  const calls = [];
  return {
    store,
    calls,
    getStorageSync(key) { return store.get(key); },
    setStorageSync(key, value) { store.set(key, value); },
    getUserProfile(options) {
      calls.push(options);
      options.success({ userInfo: { nickName: "雄狮队长", avatarUrl: "https://wx.qlogo.cn/avatar.png" } });
    },
  };
}

const wx = makeWx();
let timestamp = 1_800_000_000_000;
const leaderboard = createLeaderboard({ wxApi: wx, now: () => ++timestamp });

assert.equal(leaderboard.snapshot().stats.matches, 0);
assert.equal(wx.calls.length, 0, "排行榜初始化不可主动索取昵称头像");
const profile = await leaderboard.requestProfile();
assert.equal(wx.calls.length, 1, "仅用户主动触发时索取资料");
assert.match(wx.calls[0].desc, /排行榜/);
assert.equal(profile.profile.nickname, "雄狮队长");
assert.equal(profile.profile.avatarUrl, "https://wx.qlogo.cn/avatar.png");
const region = await createRegionalTeam({ code: "440983101000" });
assert.equal(leaderboard.setRegion(region).region.name, "镇隆");
assert.equal(leaderboard.snapshot().region.scope.key, "440983:town");

const matches = [
  [[2, 0], { matchId: "match_0001" }],
  [[1, 1], { matchId: "match_0002" }],
  [[0, 2], { matchId: "match_0003" }],
  [[3, 0], { matchId: "match_0004" }],
  [[1, 0], { matchId: "match_0005" }],
];
for (const [score, config] of matches) assert.equal(leaderboard.recordMatch({ score }, config).accepted, true);
const state = leaderboard.snapshot();
assert.equal(state.stats.matches, MIN_RANK_MATCHES);
assert.equal(state.stats.wins, 3);
assert.equal(state.stats.draws, 1);
assert.equal(state.stats.losses, 1);
assert.equal(state.stats.goalsFor, 7);
assert.equal(state.stats.goalsAgainst, 3);
assert.equal(state.stats.cleanSheets, 3);
assert.equal(state.stats.points, 10);
assert.equal(state.values.winRate, 60);
assert.equal(state.qualified, true);

assert.equal(leaderboard.recordMatch({ score: [2, 0] }, { matchId: "match_0001" }).reason, "duplicate", "好友结算重放不可重复计分");
assert.equal(leaderboard.recordMatch({ score: [0, 3] }, { matchId: "guest_0001", localRole: "guest", friendPhase: "friend" }).match.mine, 3, "好友蓝方必须按蓝方比分结算");
assert.equal(leaderboard.recordMatch({ score: ["bad", 0] }, {}).accepted, false, "非法比分不可写入榜单");

const matchesBeforeWatch = leaderboard.snapshot().stats.matches;
const watchResult = leaderboard.recordMatch({ score: [9, 0] }, { matchId: "watch_0001", mode: "watch" });
assert.equal(watchResult.accepted, false, "观看 AI 对战不得计入本机战绩");
assert.equal(watchResult.reason, "watch_mode");
assert.equal(leaderboard.snapshot().stats.matches, matchesBeforeWatch, "观战结算后比赛场次必须保持不变");

const reloaded = createLeaderboard({ wxApi: wx });
assert.equal(reloaded.snapshot().stats.matches, 6, "战绩必须跨重启持久化");
assert.equal(reloaded.snapshot().region.name, "镇隆", "自愿选择的地区队必须跨重启保存");
assert.equal(STORAGE_KEY, "rural-football:leaderboard:v1");
console.log("[test-leaderboard] PASS：主动授权、全指标统计、好友蓝方结算、防重放与本地持久化正常");
