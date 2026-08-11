import test from "node:test";
import assert from "node:assert/strict";

import { PLACES } from "../src/content/places-data.js";
import { countiesOf, createRivalTeam, createTeam, listProvinces } from "../src/content/teams.js";
import { CULTURE_FAMILIES, PROVINCE_STYLES, cultureFor } from "../src/content/regions.js";
import { BODY_ARCHETYPES, generateSquad, rolesForFormat } from "../src/content/people.js";
import { knownProps } from "../src/art/props.js";

test("地名数据覆盖 30 个以上省级单位，且全部为真实乡镇名", () => {
  assert.ok(PLACES.provinces.length >= 30, `省级单位只有 ${PLACES.provinces.length} 个`);
  let counties = 0;
  let towns = 0;
  for (const list of Object.values(PLACES.counties)) {
    counties += list.length;
    for (const [, , , townList] of list) {
      towns += townList.length;
      for (const town of townList) {
        assert.ok(town.length >= 1 && town.length <= 6, `乡镇名异常：${town}`);
        assert.ok(!/[a-zA-Z0-9]/.test(town), `乡镇名不应包含拉丁字符：${town}`);
      }
    }
  }
  assert.ok(counties > 2000, `区县数量偏少：${counties}`);
  assert.ok(towns > 8000, `乡镇地名数量偏少：${towns}`);
  assert.equal(PLACES.source.license, "MIT");
});

test("每个省份都能建出主队和对手，且队名带真实地名", () => {
  for (const province of listProvinces()) {
    const counties = countiesOf(province.code);
    assert.ok(counties.length > 0, `${province.name} 没有可用区县`);
    const home = createTeam({ provinceCode: province.code, countyCode: counties[0].code, townIndex: 0, perSide: 5 });
    home.townIndex = 0;
    assert.ok(home.name.endsWith("村队"), home.name);
    assert.ok(home.fullName.includes(province.name), home.fullName);
    assert.ok(home.banner.includes(counties[0].name), home.banner);
    const away = createRivalTeam(home, { perSide: 5 });
    assert.notEqual(away.name, home.name, `${province.name} 的对手与主队重名`);
    assert.notEqual(away.kit.id, home.kit.id, `${province.name} 主客队球衣撞色`);
  }
});

test("同一地区重复生成的球队完全一致（可分享、可复现）", () => {
  const a = createTeam({ provinceCode: "520000", countyCode: "522632", townIndex: 0, perSide: 7 });
  const b = createTeam({ provinceCode: "520000", countyCode: "522632", townIndex: 0, perSide: 7 });
  assert.deepEqual(a.players, b.players);
  assert.equal(a.kit.id, b.kit.id);
});

test("球员名单符合村超的人物设定", () => {
  const squad = generateSquad({ seedText: "522632:古州", roles: rolesForFormat(7), teamName: "古州村队" });
  assert.equal(squad.length, 7);
  const numbers = squad.map((p) => p.number);
  assert.equal(new Set(numbers).size, numbers.length, "号码不能重复");
  assert.equal(squad[0].role, "G");
  assert.equal(squad[0].number, 1, "门将应为 1 号");
  for (const player of squad) {
    assert.ok(player.age >= 16 && player.age <= 58, `年龄超出村队范围：${player.age}`);
    assert.ok(BODY_ARCHETYPES[player.archetype], `未知身材原型：${player.archetype}`);
    assert.ok(player.body.height > 1.5 && player.body.height < 1.95, `身高异常：${player.body.height}`);
    assert.ok(player.vocation.length > 0, "每名球员都要有职业");
    for (const key of ["pace", "power", "control", "stamina", "guts"]) {
      assert.ok(player[key] > 0 && player[key] <= 1, `${key} 超范围`);
    }
    assert.ok(player.look.skin.startsWith("#"));
  }
  // 一支队里应当有明显的身材差异，不能全是同一个模子
  assert.ok(new Set(squad.map((p) => p.archetype)).size >= 3, "身材原型太单一");
});

test("34 个省级行政区都映射到有效的地域家族与小品", () => {
  const props = new Set(knownProps());
  for (const [code, style] of Object.entries(PROVINCE_STYLES)) {
    assert.ok(CULTURE_FAMILIES[style.family], `${code} 的家族无效：${style.family}`);
    const culture = cultureFor(code);
    assert.ok(culture.props.length >= 6, `${code} 的小品太少`);
    assert.ok(culture.flavor.length > 0);
    assert.ok(culture.cheer.length > 0);
    const missing = culture.props.filter((id) => !props.has(id));
    assert.equal(missing.length, 0, `${code} 引用了未实现的小品：${missing.join(",")}`);
  }
  assert.equal(Object.keys(CULTURE_FAMILIES).length, 9, "母版家族应为 9 个");
});

test("九个地域家族的配色互不相同（观感可区分）", () => {
  const grass = new Set();
  const sky = new Set();
  for (const family of Object.values(CULTURE_FAMILIES)) {
    grass.add(family.ground.grass);
    sky.add(family.sky.top);
    assert.ok(family.props.length >= 6);
    assert.ok(family.crowd.palette.length >= 4);
  }
  assert.ok(grass.size >= 8, "草地色过于雷同");
  assert.ok(sky.size >= 8, "天色过于雷同");
});

test("村寨杯四轮对手全部来自真实地名且互不重复", async () => {
  const { createCup, currentRound, advanceCup } = await import("../src/content/season.js");
  for (const [provinceCode, countyCode] of [["520000", "522632"], ["610000", "610322"], ["230000", null]]) {
    const county = countyCode || countiesOf(provinceCode)[2].code;
    const cup = createCup({ provinceCode, countyCode: county, townIndex: 0, perSide: 5 });
    assert.equal(cup.rounds.length, 4);
    const names = new Set();
    for (const round of cup.rounds) {
      assert.ok(round.opponent.name.endsWith("村队"));
      assert.ok(round.opponent.place.county.length > 0);
      assert.notEqual(round.opponent.id, cup.home.id, "对手不能是自己");
      names.add(round.opponent.id);
    }
    assert.equal(names.size, 4, "四轮对手不应重复");
    for (let i = 0; i < 4; i += 1) {
      assert.ok(currentRound(cup));
      advanceCup(cup, true);
    }
    assert.equal(cup.champion, true);
    const lost = createCup({ provinceCode, countyCode: county, townIndex: 0, perSide: 5 });
    advanceCup(lost, false);
    assert.equal(lost.finished, true);
    assert.equal(lost.champion, false);
  }
});
