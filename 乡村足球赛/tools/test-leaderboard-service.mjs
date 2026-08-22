import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLeaderboardService } from "../server/leaderboard-service.mjs";
import { ProtocolError } from "../server/protocol.mjs";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rural-football-rank-"));
const dataFile = path.join(directory, "leaderboard.json");
let now = 1_800_000_000_000;
const checkedNicknames = [];
const service = await createLeaderboardService({
  host: "127.0.0.1",
  port: 0,
  dataFile,
  now: () => ++now,
  verifyWxCode: async (code) => ({ userId: `openid:${code}` }),
  checkProfileText: async ({ content, openid }) => {
    checkedNicknames.push({ content, openid });
    if (content === "违规昵称") throw new ProtocolError("CONTENT_CHECK_REJECTED", "用户文本未通过内容安全检查");
  },
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
const rankedConfig = { redTeam: "argentina", blueTeam: "portugal", redFormation: "2-3-1", blueFormation: "3-2-1", ai: 1, time: 6 };
assert.equal((await call("POST", "/ranked-matches", { config: rankedConfig }, token)).body.code, "PROFILE_REQUIRED");
const rejectedProfile = await call("PUT", "/profile", { nickname: "违规昵称", avatarUrl: "https://wx.qlogo.cn/a.png" }, token);
assert.equal(rejectedProfile.status, 422);
assert.equal(rejectedProfile.body.code, "CONTENT_CHECK_REJECTED");
const profile = await call("PUT", "/profile", { nickname: "镇隆队长", avatarUrl: "https://wx.qlogo.cn/a.png" }, token);
assert.equal(profile.status, 200);
assert.deepEqual(checkedNicknames.at(-1), { content: "镇隆队长", openid: "openid:player-one" });
const rejectedVillage = await call("PUT", "/region", { code: "440983101000", customName: "违规昵称" }, token);
assert.equal(rejectedVillage.status, 422, "公开自定义村队名必须经过内容安全检查");
const region = await call("PUT", "/region", { code: "440983101000" }, token);
assert.equal(region.status, 200);
assert.equal(region.body.region.name, "镇隆");
assert.equal(region.body.region.scope.key, "CN:rural");
assert.equal(region.body.region.fullTeamName, "广东省茂名市信宜市镇隆镇乡亲联队");

async function issueAndSettle(playerToken, score) {
  const issued = await call("POST", "/ranked-matches", { config: rankedConfig }, playerToken);
  assert.equal(issued.status, 201);
  assert.match(issued.body.match.id, /^rank_[A-Za-z0-9_-]+$/);
  now += 10_000;
  const result = await call("POST", `/ranked-matches/${issued.body.match.id}/result`, {
    score: { mine: score[0], opponent: score[1] },
  }, playerToken);
  return { issued, result };
}

let firstMatchId = "";
for (const [index, score] of [[2, 0], [1, 1], [0, 1], [3, 0], [1, 0]].entries()) {
  const settled = await issueAndSettle(token, score);
  if (index === 0) firstMatchId = settled.issued.body.match.id;
  const result = settled.result;
  assert.equal(result.status, 200);
}
assert.equal((await call("POST", "/results", { matchId: "forged_000001", score: { mine: 20, opponent: 0 } }, token)).body.code, "LEGACY_RESULT_DISABLED", "旧直传接口必须关闭");
const duplicate = await call("POST", `/ranked-matches/${firstMatchId}/result`, { score: { mine: 20, opponent: 0 } }, token);
assert.equal(duplicate.body.duplicate, true, "同一比赛不可重复入榜");
const leaderboard = await call("GET", "/leaderboards?metric=points", null, token);
assert.equal(leaderboard.status, 200);
assert.equal(leaderboard.body.rows.length, 1);
assert.equal(leaderboard.body.rows[0].nickname, "镇隆队长");
assert.equal(leaderboard.body.rows[0].value, 10);
assert.equal(leaderboard.body.self.rank, 1);
const rate = await call("GET", "/leaderboards?metric=winRate", null, token);
assert.equal(rate.body.rows[0].value, 60);
assert.equal((await call("GET", "/leaderboards?metric=points", null)).status, 200, "公开榜单无需读取用户身份");

const secondAuth = await call("POST", "/auth", { code: "player-two" });
const secondToken = secondAuth.body.token;
assert.equal((await call("PUT", "/profile", { nickname: "村队后卫", avatarUrl: "https://wx.qlogo.cn/b.png" }, secondToken)).status, 200);
assert.equal((await call("PUT", "/region", { code: "440983101000" }, secondToken)).body.region.name, "镇隆");
for (let index = 0; index < 5; index += 1) {
  const { result } = await issueAndSettle(secondToken, [1, 0]);
  assert.equal(result.status, 200);
}
const foreign = await call("POST", `/ranked-matches/${firstMatchId}/result`, { score: { mine: 1, opponent: 0 } }, secondToken);
assert.equal(foreign.body.code, "RANKED_MATCH_NOT_FOUND", "排位凭证不得跨账号使用");
const regional = await call("GET", "/leaderboards?metric=points&scope=440983%3Arural", null, token);
assert.equal(regional.status, 200);
assert.equal(regional.body.regional, true);
assert.equal(regional.body.scope.title, "信宜乡村榜");
assert.equal(regional.body.rows.length, 8, "开服地区榜必须保持基础展示容量");
const zhenlongRow = regional.body.rows.find((row) => row.teamName === "广东省茂名市信宜市镇隆镇乡亲联队");
assert.equal(zhenlongRow.value, 25, "同一完整乡镇队的合格玩家必须汇总为同一地区队");
assert.equal(zhenlongRow.contributors, 2);
assert.equal(regional.body.rows.filter((row) => row.baseline).length, 7, "一支真实队伍必须替代一支基础队伍");
assert.equal(regional.body.self.rank, zhenlongRow.rank, "玩家应看到所在乡镇队的排名");
assert.equal((await call("GET", "/leaderboards?metric=points&scope=not-valid", null)).body.code, "REGION_SCOPE_INVALID");
const removed = await call("DELETE", "/account", null, token);
assert.equal(removed.body.deleted, true, "玩家必须能够删除自己的榜单资料和统计");
const afterFirstRemoval = await call("GET", "/leaderboards?metric=points&scope=440983%3Arural", null);
assert.equal(afterFirstRemoval.body.rows.find((row) => row.teamName === "广东省茂名市信宜市镇隆镇乡亲联队").value, 15, "删除账号后地区队只保留剩余贡献者的统计");
assert.equal((await call("DELETE", "/account", null, secondToken)).body.deleted, true);
assert.equal((await call("GET", "/leaderboards?metric=points", null)).body.rows.length, 0, "删除后不可继续公开显示");
assert.equal((await call("GET", "/leaderboards?metric=points", null, token)).status, 401, "删除账户后旧会话必须立即失效");

await service.close();

const guardedService = await createLeaderboardService({
  host: "127.0.0.1",
  port: 0,
  now: () => now,
  verifyWxCode: async (code) => ({ userId: `openid:${code}` }),
  checkProfileText: null,
  rateLimits: { auth: { limit: 1, windowMs: 60_000 } },
});
const guardedBase = guardedService.url();
async function guardedCall(endpoint, body, token = "") {
  const response = await fetch(`${guardedBase}${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, retryAfter: response.headers.get("retry-after"), body: await response.json() };
}
const firstGuardedAuth = await guardedCall("/auth", { code: "guarded-one" });
assert.equal(firstGuardedAuth.status, 200);
const blockedAuth = await guardedCall("/auth", { code: "guarded-two" });
assert.equal(blockedAuth.status, 429, "同一来源超过认证频率限制后必须返回 429");
assert.match(blockedAuth.retryAfter, /^\d+$/);
const noCheckerResponse = await fetch(`${guardedBase}/profile`, {
  method: "PUT",
  headers: { "content-type": "application/json", authorization: `Bearer ${firstGuardedAuth.body.token}` },
  body: JSON.stringify({ nickname: "正常昵称", avatarUrl: "https://wx.qlogo.cn/c.png" }),
});
const noCheckerBody = await noCheckerResponse.json();
assert.equal(noCheckerResponse.status, 503, "未配置内容安全服务时不得保存公开昵称");
assert.equal(noCheckerBody.code, "CONTENT_CHECK_CONFIG_MISSING");
await guardedService.close();
await fs.rm(directory, { recursive: true, force: true });
console.log("[test-leaderboard-service] PASS：服务端签发排位、内容安全、接口限流、跨账号防刷、乡村三级指标榜与账号删除正常");
