import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createRegionalTeam,
  regionMatchesScope,
  regionalTeamKey,
  ruralScopeOptions,
  snapshotRegion,
  validScopeKey,
} = require("../src/data/region-league");

const province = await createRegionalTeam({ code: "440000" });
assert.deepEqual(province.scope, { key: "CN:rural", title: "全国乡村榜", childLevel: "town", parentCode: "CN" });
assert.equal(province.name, "广东");

const city = await createRegionalTeam({ code: "440100" });
assert.equal(city.scope.key, "CN:rural");
assert.equal(city.name, "广州");

const county = await createRegionalTeam({ code: "440983" });
assert.equal(county.scope.key, "CN:rural");
assert.equal(county.name, "信宜");

const town = await createRegionalTeam({ code: "440983101000" });
assert.equal(town.scope.key, "CN:rural");
assert.equal(town.scope.title, "全国乡村榜");
assert.equal(town.name, "镇隆");
assert.equal(town.fullRegionName, "广东省茂名市信宜市镇隆镇");
assert.equal(town.fullTeamName, "广东省茂名市信宜市镇隆镇乡亲联队");
assert.deepEqual(town.path.map((item) => item.level), ["province", "city", "county", "town"]);
const village = await createRegionalTeam({ code: "440983101000", customName: "天后街队" });
assert.equal(village.fullTeamName, "广东省茂名市信宜市镇隆镇天后街队");
assert.deepEqual(
  ruralScopeOptions(village).map((item) => [item.id, item.key, item.enabled]),
  [
    ["nation", "CN:rural", true],
    ["province", "440000:rural", true],
    ["city", "440900:rural", true],
    ["county", "440983:rural", true],
    ["town", "440983101000:village", true],
  ],
);
assert.deepEqual(
  ruralScopeOptions(village).map((item) => item.title),
  ["全国乡村榜", "广东省乡村榜", "茂名市乡村榜", "信宜市乡村榜", "镇隆镇村队榜"],
  "地区榜标题必须使用官方全称",
);
assert.equal(regionMatchesScope(village, "CN:rural"), true);
assert.equal(regionMatchesScope(village, "440000:rural"), true);
assert.equal(regionMatchesScope(village, "440100:rural"), false);
assert.equal(regionalTeamKey(village), "440983101000|天后街队");
assert.equal(snapshotRegion({ code: "440100", name: "广州", level: "city", scope: city.scope }).name, "广州");
assert.equal(snapshotRegion({ code: "440100", name: "广州", level: "city", scope: { key: "invalid" } }).scope.key, "CN:rural", "旧或非法范围必须回落全国乡村榜");
assert.equal(validScopeKey("440900:rural"), "440900:rural");
assert.equal(validScopeKey("440983101000:village"), "440983101000:village");
assert.equal(validScopeKey("440900:village"), "");
await assert.rejects(() => createRegionalTeam({ code: "not-a-region" }), /请选择有效/);
console.log("[test-region-league] PASS：全国、省内、市内、县内地区战队层级与末级名称正常");
