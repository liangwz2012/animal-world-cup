import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createLeaderboardClient } = require("../src/net/leaderboard-client");

const storage = new Map();
const calls = [];
let loginCalls = 0;
const wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
  login({ success }) { loginCalls += 1; success({ code: `code-${loginCalls}` }); },
  request(options) {
    calls.push(options);
    if (options.url.endsWith("/auth")) return options.success({ statusCode: 200, data: { ok: true, token: "x".repeat(32), expiresAt: 1_900_000_000_000 } });
    if (options.url.includes("/leaderboards")) return options.success({ statusCode: 200, data: { ok: true, metric: "points", regional: true, rows: [{ rank: 1, nickname: "广州", value: 10 }], self: null } });
    if (options.url.endsWith("/ranked-matches")) return options.success({ statusCode: 201, data: { ok: true, match: { id: "rank_server_000001" } } });
    return options.success({ statusCode: 200, data: { ok: true, profile: { nickname: "镇隆队长" } } });
  },
};
const client = createLeaderboardClient({ wxApi: wx, url: "https://rank.example.com", now: () => 1_800_000_000_000 });
assert.equal(client.available(), true);
await client.updateProfile({ nickname: "镇隆队长", avatarUrl: "https://wx.qlogo.cn/a.png" });
await client.updateRegion({ code: "440983101000", customName: "天后街队" });
const issued = await client.createRankedMatch({ redTeam: "argentina", blueTeam: "portugal", redFormation: "2-3-1", blueFormation: "3-2-1", ai: 1, time: 6 });
assert.equal(issued.match.id, "rank_server_000001");
await client.submitRankedResult(issued.match.id, { mine: 2, opponent: 1 });
assert.equal(loginCalls, 1, "有效会话必须复用，不可每次请求重新 wx.login");
assert.equal(calls.filter((call) => call.url.endsWith("/auth")).length, 1);
assert.equal(calls.find((call) => call.url.endsWith("/profile")).header.authorization, `Bearer ${"x".repeat(32)}`);
assert.deepEqual(calls.find((call) => call.url.endsWith("/region")).data, { code: "440983101000", customName: "天后街队" });
assert.equal(calls.find((call) => call.url.endsWith("/ranked-matches")).data.config.time, 6);
assert.match(calls.find((call) => call.url.includes("/ranked-matches/rank_server_000001/result")).url, /\/result$/);
const list = await client.fetchLeaderboard("points", "440983:rural");
assert.equal(list.online, true);
assert.equal(list.rows[0].nickname, "广州");
assert.match(calls.find((call) => call.url.includes("/leaderboards")).url, /scope=440983%3Arural/);
const offline = createLeaderboardClient({ wxApi: wx, url: "" });
assert.equal(offline.available(), false);
assert.equal((await offline.fetchLeaderboard("wins")).online, false, "未配置域名不得偷偷联网或报错");
console.log("[test-leaderboard-client] PASS：HTTPS 配置、会话复用、静默 wx.login、授权请求与离线回落正常");
