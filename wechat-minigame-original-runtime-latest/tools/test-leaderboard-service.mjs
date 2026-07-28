import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLeaderboardService } from "../server/leaderboard-service.mjs";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "animal-football-rank-"));
const dataFile = path.join(directory, "leaderboard.json");
let now = 1_800_000_000_000;
const service = await createLeaderboardService({
  host: "127.0.0.1",
  port: 0,
  dataFile,
  now: () => ++now,
  verifyWxCode: async (code) => ({ userId: `openid:${code}` }),
});

async function call(method, endpoint, body, token = "") {
  const response = await fetch(`${service.url()}${endpoint}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

const auth = await call("POST", "/auth", { code: "player-one" });
assert.equal(auth.status, 200);
assert.match(auth.body.token, /^[A-Za-z0-9_-]{32,}$/);
const token = auth.body.token;
assert.equal((await call("POST", "/results", { matchId: "match_000001", score: { mine: 2, opponent: 0 } }, token)).body.code, "PROFILE_REQUIRED");
const profile = await call("PUT", "/profile", { nickname: "雄狮队长", avatarUrl: "https://wx.qlogo.cn/a.png" }, token);
assert.equal(profile.status, 200);

for (const [index, score] of [[2, 0], [1, 1], [0, 1], [3, 0], [1, 0]].entries()) {
  const result = await call("POST", "/results", {
    matchId: `match_00000${index + 1}`,
    score: { mine: score[0], opponent: score[1] },
  }, token);
  assert.equal(result.status, 200);
}
const duplicate = await call("POST", "/results", { matchId: "match_000001", score: { mine: 2, opponent: 0 } }, token);
assert.equal(duplicate.body.duplicate, true, "同一比赛不可重复入榜");
const leaderboard = await call("GET", "/leaderboards?metric=points", null, token);
assert.equal(leaderboard.status, 200);
assert.equal(leaderboard.body.rows.length, 1);
assert.equal(leaderboard.body.rows[0].nickname, "雄狮队长");
assert.equal(leaderboard.body.rows[0].value, 10);
assert.equal(leaderboard.body.self.rank, 1);
const rate = await call("GET", "/leaderboards?metric=winRate", null, token);
assert.equal(rate.body.rows[0].value, 60);
assert.equal((await call("GET", "/leaderboards?metric=points", null)).status, 200, "公开榜单无需读取用户身份");
const removed = await call("DELETE", "/account", null, token);
assert.equal(removed.body.deleted, true, "玩家必须能够删除自己的榜单资料和统计");
assert.equal((await call("GET", "/leaderboards?metric=points", null)).body.rows.length, 0, "删除后不可继续公开显示");
assert.equal((await call("GET", "/leaderboards?metric=points", null, token)).status, 401, "删除账户后旧会话必须立即失效");

await service.close();
await fs.rm(directory, { recursive: true, force: true });
console.log("[test-leaderboard-service] PASS：会话复用、授权资料、全指标榜单、重放保护与公开查询正常");
