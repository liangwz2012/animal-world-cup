import assert from "node:assert/strict";
import { ProtocolError } from "../server/protocol.mjs";
import { createWxTextSecurityChecker } from "../server/wx-content-security.mjs";

const calls = [];
const checker = createWxTextSecurityChecker({
  appId: "wx-test-app",
  appSecret: "server-only-secret",
  fetchImpl: async (url, init = {}) => {
    const parsed = new URL(url);
    calls.push({ parsed, init });
    if (parsed.pathname === "/cgi-bin/token") {
      return { ok: true, status: 200, json: async () => ({ access_token: "access-token", expires_in: 7200 }) };
    }
    return { ok: true, status: 200, json: async () => ({ errcode: 0, result: { suggest: "pass" } }) };
  },
});

assert.equal(checker.available, true);
assert.equal(await checker({ content: "青石村", openid: "openid-user" }), true);
assert.equal(await checker({ content: "水口队", openid: "openid-user" }), true);
assert.equal(calls.filter(({ parsed }) => parsed.pathname === "/cgi-bin/token").length, 1, "access_token 应复用缓存");
const checkCall = calls.find(({ parsed }) => parsed.pathname === "/wxa/msg_sec_check");
assert.equal(checkCall.parsed.searchParams.get("access_token"), "access-token");
assert.deepEqual(JSON.parse(checkCall.init.body), {
  content: "青石村",
  version: 2,
  scene: 2,
  openid: "openid-user",
});

const unavailable = createWxTextSecurityChecker({ appId: "", appSecret: "", fetchImpl: async () => ({}) });
assert.equal(unavailable.available, false);
await assert.rejects(
  () => unavailable({ content: "青石村", openid: "openid-user" }),
  (error) => error instanceof ProtocolError && error.code === "CONTENT_CHECK_CONFIG_MISSING",
);

const rejected = createWxTextSecurityChecker({
  appId: "wx-test-app",
  appSecret: "server-only-secret",
  fetchImpl: async (url) => new URL(url).pathname === "/cgi-bin/token"
    ? { ok: true, status: 200, json: async () => ({ access_token: "access-token", expires_in: 7200 }) }
    : { ok: true, status: 200, json: async () => ({ errcode: 0, result: { suggest: "risky" } }) },
});
await assert.rejects(
  () => rejected({ content: "不合规队名", openid: "openid-user" }),
  (error) => error instanceof ProtocolError && error.code === "CONTENT_CHECK_REJECTED",
);

console.info("[test:wx-content-security] PASS：凭证仅服务端使用、令牌缓存、通过/拒绝和缺配置边界正常");
