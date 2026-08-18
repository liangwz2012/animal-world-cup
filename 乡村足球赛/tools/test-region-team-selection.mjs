import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createRegionTeamSelection,
  jerseyIdentity,
  pickStableOpponent,
  rerollOpponent,
  resolveOpponentPool,
  selectManualOpponent,
  selectRegion,
  setCustomTeamName,
} = require("../src/data/region-team-selection.js");

const townSelection = await createRegionTeamSelection({
  path: ["440000", "440900", "440983", "440983101000"],
  customName: " 镇 隆 青 年 队 ",
});
assert.deepEqual(
  townSelection.locationCodes,
  ["440000", "440900", "440983", "440983101000"],
  "选队状态必须保存完整省市县乡路径",
);
assert.equal(townSelection.displayName, "镇隆青年队");
assert.equal(townSelection.leaf.level, "town");

const jersey = jerseyIdentity(townSelection, 7);
assert.deepEqual(jersey.locationCodes, ["440983", "440983101000"], "球衣只消费最细一级及直接上级");
assert.equal(jersey.customName, "镇隆青年队");
assert.equal(jersey.locationLabel, "镇隆青年队");
assert.equal(jersey.number, 7);

const firstOpponent = await pickStableOpponent(townSelection, { seed: "same-session" });
const repeatedOpponent = await pickStableOpponent(townSelection, { seed: "same-session" });
assert.ok(firstOpponent.opponent);
assert.equal(firstOpponent.opponent.code, repeatedOpponent.opponent.code, "同一选择和种子必须得到稳定对手");
assert.equal(firstOpponent.opponent.level, "town");
assert.equal(firstOpponent.opponent.parentCode, "440983");
assert.notEqual(firstOpponent.opponent.code, townSelection.leaf.code);
assert.equal(firstOpponent.fallback, false);

const changedOpponent = await rerollOpponent(townSelection, firstOpponent.opponent, {
  seed: "same-session",
  nonce: firstOpponent.nonce,
});
assert.ok(changedOpponent.opponent);
assert.notEqual(changedOpponent.opponent.code, firstOpponent.opponent.code, "候选充足时换一个必须得到不同对手");
assert.equal(changedOpponent.level, "town");

const manualOpponent = await selectManualOpponent(townSelection, firstOpponent.candidates[0].code);
assert.equal(manualOpponent.manual, true);
assert.equal(manualOpponent.opponent.code, firstOpponent.candidates[0].code);
await assert.rejects(
  () => selectManualOpponent(townSelection, "440100"),
  /同级同父地区/,
  "手选对手不得越级或跨认知范围",
);

const switchedCity = await selectRegion(townSelection, "440100");
assert.deepEqual(switchedCity.locationCodes, ["440000", "440100"]);
assert.equal(switchedCity.customName, "", "切换上级地区必须清空旧的下级路径和自定义队名");
const renamed = await setCustomTeamName(switchedCity, " 广 州 村 超 <一队> ");
assert.equal(renamed.customName, "广州村超一队");

const beijingSelection = await createRegionTeamSelection({
  path: ["110000", "110101"],
});
assert.equal(beijingSelection.leaf.name, "东城区", "直辖市应允许省级节点直接选择区县");
const beijingPool = await resolveOpponentPool(beijingSelection);
assert.ok(beijingPool.candidates.some((item) => item.code === "110102"));
assert.ok(beijingPool.candidates.every((item) => item.level === "county" && item.parentCode === "110000"));

function fixtureApi(singleCountyCandidate) {
  const entries = {
    P1: { code: "P1", parentCode: "", level: "province", name: "甲省", shortName: "甲" },
    P2: { code: "P2", parentCode: "", level: "province", name: "乙省", shortName: "乙" },
    C1: { code: "C1", parentCode: "P1", level: "city", name: "甲市", shortName: "甲市" },
    C2: { code: "C2", parentCode: "P1", level: "city", name: "乙市", shortName: "乙市" },
    C3: { code: "C3", parentCode: "P1", level: "city", name: "丙市", shortName: "丙市" },
    D1: { code: "D1", parentCode: "C1", level: "county", name: "甲县", shortName: "甲县" },
    D2: { code: "D2", parentCode: "C1", level: "county", name: "乙县", shortName: "乙县" },
  };
  return {
    entry(code) { return entries[code] || null; },
    children(parentCode) {
      if (!parentCode) return [entries.P1, entries.P2];
      if (parentCode === "P1") return [entries.C1, entries.C2, entries.C3];
      if (parentCode === "C1") return singleCountyCandidate ? [entries.D1, entries.D2] : [entries.D1];
      return [];
    },
  };
}

const noSiblingApi = fixtureApi(false);
const noSiblingSelection = await createRegionTeamSelection({ path: ["P1", "C1", "D1"] }, noSiblingApi);
const fallbackPool = await resolveOpponentPool(noSiblingSelection, noSiblingApi);
assert.equal(fallbackPool.fallback, true);
assert.equal(fallbackPool.fallbackDepth, 1);
assert.equal(fallbackPool.level, "city");
assert.deepEqual(fallbackPool.candidates.map((item) => item.code), ["C2", "C3"]);

const oneSiblingApi = fixtureApi(true);
const oneSiblingSelection = await createRegionTeamSelection({ path: ["P1", "C1", "D1"] }, oneSiblingApi);
const onlyOpponent = await pickStableOpponent(oneSiblingSelection, oneSiblingApi);
assert.equal(onlyOpponent.opponent.code, "D2", "只有一个同级对手时首轮应直接使用");
const rerolledFallback = await rerollOpponent(oneSiblingSelection, onlyOpponent.opponent, oneSiblingApi);
assert.equal(rerolledFallback.fallback, true, "只有一个同级对手时换一个应向上级认知范围回退");
assert.equal(rerolledFallback.level, "city");
assert.ok(["C2", "C3"].includes(rerolledFallback.opponent.code));

console.info("[test:region-team-selection] PASS：完整路径、自定义队名、同级匹配、稳定随机、手选与稀疏候选回退正常");
