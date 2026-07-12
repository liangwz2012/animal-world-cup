import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DEVTOOLS_ROOM_WS_URL,
  createFriendAuth,
  devPlayerId,
  resolveFriendService,
  wxLoginCode,
} = require("../src/net/friend-service-config.js");

const storage = new Map();
const devWx = {
  getSystemInfoSync: () => ({ platform: "devtools" }),
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
};
const local = resolveFriendService({ wxApi: devWx, globalObject: {} });
assert.equal(local.ok, true);
assert.equal(local.url, DEVTOOLS_ROOM_WS_URL);
assert.equal(local.localOnly, true);
const firstId = devPlayerId(devWx, {}, () => 0.25);
assert.match(firstId, /^dev_[A-Za-z0-9_]+$/);
assert.equal(devPlayerId(devWx, {}, () => 0.5), firstId, "开发者工具刷新后必须复用同一测试身份");
assert.equal((await createFriendAuth({ wxApi: devWx, globalObject: {}, endpoint: local })).devPlayerId, firstId);

const production = resolveFriendService({
  wxApi: { getSystemInfoSync: () => ({ platform: "ios" }) },
  globalObject: { __ANIMAL_FOOTBALL_ROOM_WSS__: "wss://rooms.example.com/friend" },
});
assert.deepEqual(production, { ok: true, url: "wss://rooms.example.com/friend" });
assert.equal(resolveFriendService({
  wxApi: { getSystemInfoSync: () => ({ platform: "ios" }) },
  globalObject: {},
}).reason, "missing");

assert.equal(await wxLoginCode({ login: ({ success }) => success({ code: "wx-code" }) }), "wx-code");
await assert.rejects(() => wxLoginCode({ login: ({ fail }) => fail({ errMsg: "denied" }) }), /denied/);

console.info("[test:friend-service-config] PASS：开发者工具本机服务、生产 WSS 与微信登录配置正常");
