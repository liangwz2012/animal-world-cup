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
    if (options.url.includes("/leaderboards")) return options.success({ statusCode: 200, data: { ok: true, metric: "points", rows: [{ rank: 1, nickname: "雄狮队长", value: 10 }], self: null } });
    return options.success({ statusCode: 200, data: { ok: true, profile: { nickname: "雄狮队长" } } });
  },
};
const client = createLeaderboardClient({ wxApi: wx, url: "https://rank.example.com", now: () => 1_800_000_000_000 });
assert.equal(client.available(), true);
await client.updateProfile({ nickname: "雄狮队长", avatarUrl: "https://wx.qlogo.cn/a.png" });
await client.submitResult({ matchId: "friend_000001", score: { mine: 2, opponent: 1 } });
assert.equal(loginCalls, 1, "有效会话必须复用，不可每次请求重新 wx.login");
assert.equal(calls.filter((call) => call.url.endsWith("/auth")).length, 1);
assert.equal(calls.find((call) => call.url.endsWith("/profile")).header.authorization, `Bearer ${"x".repeat(32)}`);
const list = await client.fetchLeaderboard("points");
assert.equal(list.online, true);
assert.equal(list.rows[0].nickname, "雄狮队长");
const offline = createLeaderboardClient({ wxApi: wx });
assert.equal(offline.available(), false);
assert.equal((await offline.fetchLeaderboard("wins")).online, false, "未配置域名不得偷偷联网或报错");
console.log("[test-leaderboard-client] PASS：HTTPS 配置、会话复用、静默 wx.login、授权请求与离线回落正常");
