import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createRegionalTeam, snapshotRegion, validScopeKey } = require("../src/data/region-league");

const province = await createRegionalTeam({ code: "440000" });
assert.deepEqual(province.scope, { key: "CN:province", title: "全国省队榜", childLevel: "province", parentCode: "CN" });
assert.equal(province.name, "广东");

const city = await createRegionalTeam({ code: "440100" });
assert.equal(city.scope.key, "440000:city");
assert.equal(city.scope.title, "广东城市榜");
assert.equal(city.name, "广州");

const county = await createRegionalTeam({ code: "440983" });
assert.equal(county.scope.key, "440900:county");
assert.equal(county.scope.title, "茂名区县榜");
assert.equal(county.name, "信宜");

const town = await createRegionalTeam({ code: "440983101000" });
assert.equal(town.scope.key, "440983:town");
assert.equal(town.scope.title, "信宜乡镇榜");
assert.equal(town.name, "镇隆");
assert.equal(snapshotRegion({ code: "440100", name: "广州", level: "city", scope: city.scope }).name, "广州");
assert.equal(snapshotRegion({ code: "440100", name: "广州", level: "city", scope: { key: "invalid" } }), null);
assert.equal(validScopeKey("440900:county"), "440900:county");
assert.equal(validScopeKey("440900:village"), "");
await assert.rejects(() => createRegionalTeam({ code: "not-a-region" }), /请选择有效/);
console.log("[test-region-league] PASS：全国、省内、市内、县内地区战队层级与末级名称正常");
