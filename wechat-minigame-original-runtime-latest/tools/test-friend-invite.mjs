import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  FRIEND_PROTOCOL_VERSION,
  buildFriendInviteQuery,
  parseFriendInvite,
  sameInvite,
} = require("../src/net/friend-invite.js");
const {
  endpointErrorMessage,
  parseSocketUrl,
  resolveRoomEndpoint,
} = require("../src/net/room-endpoint.js");

const token = "Abcdefghijklmnop_1234567890-ROOM";
assert.deepEqual(parseFriendInvite({ query: {} }), { ok: false, reason: "missing" });
assert.deepEqual(parseFriendInvite({ query: { invite: "short", v: "1" } }), { ok: false, reason: "invalid_token" });
assert.deepEqual(parseFriendInvite({ query: { invite: token, v: "99" } }), {
  ok: false,
  reason: "incompatible_version",
  token,
  version: 99,
});
const parsed = parseFriendInvite({ query: { invite: token, v: String(FRIEND_PROTOCOL_VERSION) } });
assert.deepEqual(parsed, { ok: true, token, version: FRIEND_PROTOCOL_VERSION });
assert.equal(buildFriendInviteQuery(token), `invite=${token}&v=1`);
assert.equal(sameInvite(parsed, parseFriendInvite({ query: { invite: token, v: "1" } })), true);
assert.throws(() => buildFriendInviteQuery("bad token"), /令牌格式无效/);

assert.deepEqual(parseSocketUrl(""), { ok: false, reason: "missing" });
assert.equal(parseSocketUrl("https://rooms.example.com").reason, "secure_websocket_required");
assert.equal(parseSocketUrl("ws://rooms.example.com").reason, "secure_websocket_required");
assert.equal(parseSocketUrl("wss://rooms.example.com/friend").ok, true);
assert.equal(parseSocketUrl("wss://user:pass@rooms.example.com/friend").reason, "unsafe_url");
assert.equal(parseSocketUrl("ws://127.0.0.1:8788/friend").localOnly, true);
assert.equal(resolveRoomEndpoint({
  url: "ws://127.0.0.1:8788/friend",
  wxApi: { getSystemInfoSync: () => ({ platform: "devtools" }) },
}).ok, true);
assert.equal(resolveRoomEndpoint({
  url: "ws://127.0.0.1:8788/friend",
  wxApi: { getSystemInfoSync: () => ({ platform: "ios" }) },
}).reason, "loopback_devtools_only");
assert.match(endpointErrorMessage("missing"), /尚未配置/);

console.info("[test:friend-invite] PASS：邀请参数、协议版本和安全 WSS 配置正常");
