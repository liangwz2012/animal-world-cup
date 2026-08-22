import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { matchShareTitle, matchShareCaption, generateMatchShareCard } = require("../src/ui/share-card");
const { FALLBACK_TITLE, regionalShareTitle } = require("../src/data/regional-share");
const { normalizeRegionalShareFeature } = require("../src/data/remote-feature-contracts");

const place = (code, parentCode, level, name, shortName) => ({ code, parentCode, level, name, officialName: name, shortName });
const guangdong = place("440000", "", "province", "广东省", "广东");
const maoming = place("440900", "440000", "city", "茂名市", "茂名");
const xinyi = place("440983", "440900", "county", "信宜市", "信宜");
const zhenlong = place("440983101000", "440983", "town", "镇隆镇", "镇隆");
const shuikou = place("440983102000", "440983", "town", "水口镇", "水口");
const yangjiang = place("441700", "440000", "city", "阳江市", "阳江");
const yangchun = place("441781", "441700", "county", "阳春市", "阳春");
const heshui = place("441781101000", "441781", "town", "合水镇", "合水");
const jiangxi = place("360000", "", "province", "江西省", "江西");
const jian = place("360800", "360000", "city", "吉安市", "吉安");
const xiajiang = place("360823", "360800", "county", "峡江县", "峡江");
const shaxi = place("360823104000", "360823", "town", "沙溪镇", "沙溪");

const sameCounty = regionalShareTitle({
  redRegion: { path: [guangdong, maoming, xinyi, zhenlong] },
  blueRegion: { path: [guangdong, maoming, xinyi, shuikou] },
});
assert.equal(sameCounty, "茂名市信宜市乡村赛｜镇隆镇队 VS 水口镇队，快来踢球！");

const sameProvince = regionalShareTitle({
  redRegion: { path: [guangdong, maoming, xinyi, zhenlong] },
  blueRegion: { path: [guangdong, yangjiang, yangchun, heshui] },
});
assert.equal(sameProvince, "广东省乡村赛｜茂名镇隆队 VS 阳江合水队，快来踢球！");

const crossProvince = regionalShareTitle({
  redRegion: { path: [guangdong, maoming, xinyi, zhenlong] },
  blueRegion: { path: [jiangxi, jian, xiajiang, shaxi] },
});
assert.equal(crossProvince, "全国乡村赛｜广东镇隆队 VS 江西沙溪队，快来踢球！");

const customVillage = regionalShareTitle({
  redRegion: { path: [guangdong, maoming, xinyi, zhenlong], customName: "天后街队" },
  blueRegion: { path: [guangdong, maoming, xinyi, shuikou], customName: "横茶村队" },
});
assert.equal(customVillage, "茂名市信宜市乡村赛｜镇隆镇天后街队 VS 水口镇横茶村队，快来踢球！");

const customTemplate = normalizeRegionalShareFeature({
  sameCountyTemplate: "{{commonRegion}}村超｜{{redLeaf}} VS {{blueLeaf}}，开踢！",
});
assert.equal(regionalShareTitle({
  redRegion: { path: [guangdong, maoming, xinyi, zhenlong] },
  blueRegion: { path: [guangdong, maoming, xinyi, shuikou] },
}, customTemplate), "茂名市信宜市村超｜镇隆镇 VS 水口镇，开踢！");
assert.equal(regionalShareTitle({}, null), FALLBACK_TITLE);
assert.equal(regionalShareTitle({ redRegion: { path: [guangdong] }, blueRegion: { path: [jiangxi] } }, { enabled: false }), FALLBACK_TITLE);

// 胜：含"赢了" + 双方名 + 比分
const win = matchShareTitle({ myName: "雄狮", foeName: "美洲豹", myScore: 3, foeScore: 2 });
assert.ok(win.includes("雄狮") && win.includes("美洲豹"), "胜利标题应含双方队名");
assert.ok(win.includes("3:2") && win.includes("赢了"), "胜利标题应含比分与'赢了'");

// 平：含"平局"
const draw = matchShareTitle({ myName: "雄狮", foeName: "美洲豹", myScore: 1, foeScore: 1 });
assert.ok(draw.includes("平局") && draw.includes("1:1"), "平局标题应含'平局'与比分");

// 负：含"惜败"，且比分按我方在前
const lose = matchShareTitle({ myName: "雄狮", foeName: "美洲豹", myScore: 0, foeScore: 2 });
assert.ok(lose.includes("惜败") && lose.includes("0:2"), "失利标题应含'惜败'与比分");

// caption 三态
assert.equal(matchShareCaption(2, 2).includes("握手"), true);
assert.ok(matchShareCaption(3, 1).length > 0);
assert.ok(matchShareCaption(1, 3).includes("惜败"));

// 无 wx / 无 createCanvas 时，卡片生成回落空串，不抛错
const a = await generateMatchShareCard(null, { score: [1, 0] });
assert.equal(a, "", "无 wx 环境应回落空串");
const b = await generateMatchShareCard({}, { score: [1, 0] });
assert.equal(b, "", "无 createCanvas 应回落空串");

console.info("[test-share-card] PASS：地域对阵标题、云端模板、旧战报文案与无canvas回落均正常");
