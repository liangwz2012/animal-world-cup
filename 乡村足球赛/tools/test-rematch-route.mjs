import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveRematchRoute } = require("../src/app/rematch-route.js");
const { createSeasonJourney } = require("../src/data/season-journey.js");
const { createDailyChallenge } = require("../src/data/daily-challenge.js");
const { TEAMS } = require("../src/data/game-options.js");

assert.equal(resolveRematchRoute({ journeyMode: "season" }), "season", "赛季结算页再来一局必须回赛季签发流程");
assert.equal(resolveRematchRoute({ journeyMode: "daily" }), "daily", "每日挑战结算页再来一局必须回挑战签发流程");
assert.equal(resolveRematchRoute({}), "local", "普通单机再来一局走本地重开");
assert.equal(resolveRematchRoute({ journeyMode: "friend" }), "local");
assert.equal(resolveRematchRoute(null), "local");

const season = createSeasonJourney({ wxApi: null });
const first = season.prepareMatch({ teamId: TEAMS[0].id, teamIds: TEAMS.map((team) => team.id) });
const settled = season.recordMatch({ score: [2, 1] }, first);
assert.equal(settled.accepted, true, "赛季首局应正常结算");
const replay = season.prepareMatch({ teamId: TEAMS[0].id, teamIds: TEAMS.map((team) => team.id) });
assert.notEqual(replay.campaignMatchId, first.campaignMatchId, "再来一局必须签发新场次凭证");
assert.equal(season.recordMatch({ score: [1, 0] }, replay).accepted, true, "新场次凭证结算不得被 invalid_result 拒收");
assert.equal(season.recordMatch({ score: [3, 0] }, first).reason, "invalid_result", "旧凭证必须继续被拒，防止刷轮次");

const daily = createDailyChallenge({ wxApi: null });
const attempt = daily.prepareMatch();
assert.equal(daily.recordMatch({ score: [1, 0] }, attempt).accepted, true, "每日挑战首局应正常结算");
const retry = daily.prepareMatch();
assert.notEqual(retry.dailyAttemptId, attempt.dailyAttemptId, "每日挑战再来一局必须签发新 attemptId");
assert.equal(daily.recordMatch({ score: [2, 0] }, retry).accepted, true, "新 attemptId 结算不得被 duplicate 拒收");
assert.equal(daily.recordMatch({ score: [4, 0] }, attempt).reason, "duplicate", "旧 attemptId 必须继续被拒，防止刷最佳成绩");

console.info("[test:rematch-route] PASS：再来一局路由、赛季/挑战新凭证签发与旧凭证拒收正常");
