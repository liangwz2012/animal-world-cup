import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  children,
  compactName,
  pathTo,
  resolveJerseyLocation,
  search,
  stats,
} = require("../src/data/administrative-regions.js");

const initial = stats();
assert.equal(initial.provinces, 34, "必须包含全国 34 个省级行政区");
assert.ok(initial.cities >= 330, "必须包含完整地市数据");
assert.ok(initial.counties >= 3200, "必须包含完整县区数据");
assert.equal(compactName("广东省"), "广东");
assert.equal(compactName("镇隆镇"), "镇隆");

const provinces = await children();
assert.ok(provinces.some((item) => item.code === "440000" && item.name === "广东省"));
const guangdong = await children("440000");
assert.ok(guangdong.some((item) => item.code === "440100" && item.name === "广州市"));
const maoming = await children("440900");
assert.ok(maoming.some((item) => item.code === "440983" && item.name === "信宜市"));

for (const [provinceCode, expectedCounty] of [
  ["110000", "110101"],
  ["120000", "120101"],
  ["310000", "310101"],
  ["500000", "500101"],
]) {
  const municipalityChildren = await children(provinceCode);
  assert.ok(
    municipalityChildren.some((item) => item.code === expectedCounty && item.level === "county" && item.parentCode === provinceCode),
    `${provinceCode} 直辖市必须从省级节点直接下钻到区县`,
  );
}

for (const [provinceCode, expectedCounty] of [
  ["410000", "419001"],
  ["420000", "429004"],
  ["460000", "469001"],
  ["650000", "659001"],
]) {
  const provinceChildren = await children(provinceCode);
  assert.ok(
    provinceChildren.some((item) => item.code === expectedCounty && item.level === "county" && item.parentCode === provinceCode),
    `${provinceCode} 必须直接包含省直管县级行政区`,
  );
  assert.ok(
    !provinceChildren.some((item) => /直辖县级行政区划/.test(item.name)),
    `${provinceCode} 不应暴露无意义的省直管占位层`,
  );
}

const oneLevel = await resolveJerseyLocation({ locationCodes: ["440000"] });
assert.equal(oneLevel.label, "广东");
assert.equal(oneLevel.jersey.locationLabel, "广东");

const cityPair = await resolveJerseyLocation({ locationCodes: ["440000", "440100"] });
assert.equal(cityPair.label, "广州");
assert.equal(cityPair.valid, true);

const municipalityPair = await resolveJerseyLocation({ locationCodes: ["110000", "110101"] });
assert.equal(municipalityPair.label, "东城");
assert.equal(municipalityPair.valid, true, "直辖市省级节点与区县应视为相邻层级");

const townPair = await resolveJerseyLocation({ locationCodes: ["440983", "440983101000"] });
assert.equal(townPair.label, "镇隆");
assert.equal(townPair.jersey.village, "镇隆镇");
assert.equal(townPair.valid, true);
assert.ok((await search("镇隆")).some((item) => item.code === "440983101000"));
assert.deepEqual(
  (await pathTo("440983101000")).map((item) => item.name),
  ["广东省", "茂名市", "信宜市", "镇隆镇"],
  "任意乡镇代码必须可恢复完整省市县乡路径",
);
const xinyiTowns = await children("440983");
assert.ok(xinyiTowns.length >= 15, "信宜县级节点必须能直接加载完整乡镇列表");
assert.ok(xinyiTowns.some((item) => item.code === "440983101000" && item.name === "镇隆镇"));
assert.ok(xinyiTowns.some((item) => item.code === "440983102000" && item.name === "水口镇"));
assert.equal(stats().towns, 41278, "乡镇数据必须在需要时才载入并完整可用");

const invalidPair = await resolveJerseyLocation({ locationCodes: ["440000", "440983"] });
assert.equal(invalidPair.valid, false);
assert.equal(invalidPair.label, "信宜", "不相邻的两级选择必须回退为更细一级");

console.info("[test:administrative-regions] PASS：全国省市县区乡镇、简称、级联与队服名称解析正常");
