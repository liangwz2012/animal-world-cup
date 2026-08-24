import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  SHARE_REGION_VERSION,
  appendShareRegionQuery,
  buildShareRegionQuery,
  parseShareRegionQuery,
  shareRegionContextForLaunch,
  sharedRegionCodes,
} = require("../src/data/share-region-context.js");

const path = [
  { code: "440000", level: "province", name: "广东省" },
  { code: "440900", level: "city", name: "茂名市" },
  { code: "440983", level: "county", name: "信宜市" },
  { code: "440983101000", level: "town", name: "镇隆镇" },
];

assert.equal(SHARE_REGION_VERSION, 1);
assert.deepEqual(sharedRegionCodes({ path }), ["440000", "440900", "440983"], "乡镇分享必须剥离叶子乡镇");
assert.equal(buildShareRegionQuery({ path }), "rfv=1&rh=440000.440900.440983");
assert.deepEqual(
  parseShareRegionQuery({ query: { rfv: "1", rh: "440000.440900.440983" } }),
  { ok: true, version: 1, codes: ["440000", "440900", "440983"], key: "440000.440900.440983" },
);
assert.deepEqual(sharedRegionCodes({ path: path.slice(0, 2) }), ["440000", "440900"]);
assert.equal(appendShareRegionQuery("from=result", { path }), "from=result&rfv=1&rh=440000.440900.440983");
assert.equal(appendShareRegionQuery("", {}), "");
assert.deepEqual(parseShareRegionQuery({ query: {} }), { ok: false, reason: "missing" });
assert.deepEqual(parseShareRegionQuery({ query: { rfv: "2", rh: "440000" } }), { ok: false, reason: "unsupported_version" });
assert.deepEqual(parseShareRegionQuery({ query: { rfv: "1", rh: "440000.bad" } }), { ok: false, reason: "invalid_region" });
assert.deepEqual(parseShareRegionQuery({ query: { rfv: "1", rh: "440000.440900.440983.440983101000" } }), { ok: false, reason: "invalid_region" });
assert.deepEqual(
  shareRegionContextForLaunch({ query: { invite: "1234567890abcdef1234567890abcdef", rfv: "1", rh: "440000.440900" } }),
  { ok: false, reason: "friend_invite" },
  "好友房间邀请必须优先于地域预填",
);
assert.equal(JSON.stringify(parseShareRegionQuery({ query: { rfv: "1", rh: "440000" } })).includes("广东"), false, "分享参数不得携带中文名称");

console.info("[test-share-region-context] PASS：地域代码分享、乡镇叶子剥离、版本与非法参数回落正常");
