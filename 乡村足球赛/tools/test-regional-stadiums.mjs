import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const snapshot = require("../src/data/china-administrative-core");
const {
  AUDIENCE_POOLS,
  INTERNATIONAL_STADIUM,
  PROVINCE_PROFILES,
  REGIONAL_STADIUMS,
  STADIUM_THEMES,
  composeRegionalAudience,
  provinceCodeFromRegion,
  selectRegionalStadium,
} = require("../src/data/regional-stadiums");

const expectedProvinceCodes = (snapshot.provinces || []).map((row) => row.c).sort();
assert.equal(expectedProvinceCodes.length, 34, "行政区划快照必须包含 34 个省级地区");
assert.deepEqual(Object.keys(REGIONAL_STADIUMS).sort(), expectedProvinceCodes, "球场主题必须覆盖全部 34 个省级地区");
assert.deepEqual(Object.keys(PROVINCE_PROFILES).sort(), expectedProvinceCodes, "34 个省级地区必须各有独立文化配置");

for (const [provinceCode, stadium] of Object.entries(REGIONAL_STADIUMS)) {
  assert.equal(stadium.provinceCode, provinceCode);
  assert.equal(stadium.runtimeThemeId, "international", "正式生图资产接入前必须回退已验证的通用球场");
  assert.equal(stadium.plannedRuntimeThemeId, `province-${provinceCode}`);
  assert.ok(stadium.name && stadium.architectureId && stadium.toneId && stadium.audiencePoolId && stadium.cultureDescription);
  assert.match(stadium.primaryColor, /^#[0-9a-f]{6}$/i);
  assert.match(stadium.accentColor, /^#[0-9a-f]{6}$/i);
  assert.ok(STADIUM_THEMES[stadium.themeId], `${provinceCode} 的 themeId 必须有主题定义`);
  assert.ok(AUDIENCE_POOLS[stadium.audiencePoolId], `${provinceCode} 的 audiencePoolId 必须有观众池`);
  assert.equal(stadium.usesFallbackTheme, true, `${provinceCode} 未接入生图资产时必须明确标记回退`);
  assert.equal(stadium.overlayAsset, "", `${provinceCode} 不得使用程序绘制的占位叠加层`);
}

const guangdong = selectRegionalStadium({ code: "440983" });
assert.equal(guangdong.provinceCode, "440000");
assert.equal(guangdong.themeId, "lingnan");
assert.equal(guangdong.runtimeThemeId, "international");
assert.equal(guangdong.plannedRuntimeThemeId, "province-440000");
assert.equal(guangdong.name, "广东乡村球场");
assert.equal(guangdong.architectureId, "lingnan-arcade-village");
assert.equal(guangdong.toneId, "kapok-vermilion-green");
assert.equal(guangdong.audiencePoolId, "lingnan-neighbors");
assert.equal(guangdong.usesFallbackTheme, true);

assert.equal(provinceCodeFromRegion({ locationCodes: ["440000", "440900"] }), "440000");
assert.equal(provinceCodeFromRegion({ jersey: { locationCodes: ["440983", "440983101000"] } }), "440000");
assert.equal(selectRegionalStadium({ code: "110000" }).themeId, "capital");
assert.equal(selectRegionalStadium({ code: "650100" }).themeId, "northwest-oasis");
assert.equal(selectRegionalStadium({ code: "230100" }).themeId, "northeast");
assert.equal(selectRegionalStadium({ code: "350100" }).patternId, "fujian-tulou");
assert.equal(selectRegionalStadium({ code: "460100" }).patternId, "hainan-coconut");
assert.equal(selectRegionalStadium("not-a-region"), INTERNATIONAL_STADIUM);
assert.equal(selectRegionalStadium("team-44"), INTERNATIONAL_STADIUM, "名称中的数字不得误识别为行政区代码");

assert.equal(new Set(Object.values(REGIONAL_STADIUMS).map((row) => row.plannedRuntimeThemeId)).size, 34, "每省必须预留独立运行时球场 ID");
assert.ok(new Set(Object.values(REGIONAL_STADIUMS).map((row) => row.themeId)).size >= 8, "地域基础家族不得少于 8 套");

const frozenRegion = Object.freeze({ code: "440100", locationCodes: Object.freeze(["440000", "440100"]) });
const crowdA = composeRegionalAudience(frozenRegion, "match-2026-001", { count: 36 });
const crowdARepeat = composeRegionalAudience(frozenRegion, "match-2026-001", { count: 36 });
const crowdB = composeRegionalAudience(frozenRegion, "match-2026-002", { count: 36 });
assert.deepEqual(crowdARepeat, crowdA, "同一地区和比赛种子必须生成完全一致的观众组合");
assert.notDeepEqual(crowdB.sequence, crowdA.sequence, "不同比赛种子应生成不同观众排列");
assert.equal(crowdA.themeId, "lingnan");
assert.equal(crowdA.audiencePoolId, "lingnan-neighbors");
assert.equal(crowdA.total, 36);
assert.equal(crowdA.groups.reduce((sum, group) => sum + group.count, 0), 36);
assert.equal(crowdA.sequence.length, 36);
assert.ok(crowdA.sequence.every((item) => AUDIENCE_POOLS["lingnan-neighbors"].some((entry) => entry.id === item.archetypeId)));
assert.ok(Object.isFrozen(crowdA) && Object.isFrozen(crowdA.groups) && Object.isFrozen(crowdA.sequence));
assert.notDeepEqual(
  composeRegionalAudience("110000", "same-seed", { count: 36 }).sequence,
  composeRegionalAudience("310000", "same-seed", { count: 36 }).sequence,
  "同一地域家族的不同省份仍应参与观众排列种子",
);

const fallbackCrowd = composeRegionalAudience({ code: "invalid" }, "fallback-match", { count: 999 });
assert.equal(fallbackCrowd.themeId, "northern-plain");
assert.equal(fallbackCrowd.audiencePoolId, "plain-neighbors");
assert.equal(fallbackCrowd.total, 96, "观众占位数量必须受轻量上限保护");
assert.equal(composeRegionalAudience("440000", "empty", { count: 0 }).total, 0);

console.info("[test-regional-stadiums] PASS：34 省文化配置、八套地域家族、种子化人类观众配置及正式生图资产接入门禁正常");
