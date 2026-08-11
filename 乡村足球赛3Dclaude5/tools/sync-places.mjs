// 从 2D 版已落地的行政区划快照（uiwjs/province-city-china，MIT）派生一份"乡村地名"精简表。
// 只保留乡/镇一级的真实地名，每个区县最多 5 个，供村队命名、球场横幅和赛季对手使用。
// 用法：node tools/sync-places.mjs

import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const legacyRoot = resolve(projectRoot, "..", "乡村足球赛");
const require = createRequire(import.meta.url);

const core = require(resolve(legacyRoot, "src/data/china-administrative-core.js"));
const towns = require(resolve(legacyRoot, "region_data/game.js"));

const MAX_TOWNS_PER_COUNTY = 5;
const RURAL_SUFFIX = /(镇|乡|苏木|民族乡|民族镇)$/u;
const STRIP_SUFFIX = /(彝族|苗族|侗族|壮族|回族|藏族|白族|傣族|瑶族|土家族|哈尼族|布依族|畲族|黎族|傈僳族|佤族|拉祜族|水族|东乡族|纳西族|景颇族|柯尔克孜族|达斡尔族|仫佬族|羌族|布朗族|撒拉族|毛南族|仡佬族|锡伯族|阿昌族|普米族|朝鲜族|蒙古族|满族|鄂温克族|德昂族|裕固族|京族|塔塔尔族|独龙族|鄂伦春族|赫哲族|门巴族|珞巴族|基诺族|土族|哈萨克族|维吾尔族)*(自治)?(镇|乡|苏木)$/u;

const provinceName = new Map(core.provinces.map((row) => [row.c, row.n]));
const cityName = new Map(core.cities.map((row) => [row.c, row.n]));

const countyRows = core.areas.map((row) => {
  const provinceCode = `${row.p}0000`;
  const cityCode = `${row.p}${row.y}00`;
  return {
    code: row.c,
    name: row.n,
    provinceCode,
    province: provinceName.get(provinceCode) || "",
    city: cityName.get(cityCode) || "",
  };
});

const townsByCounty = new Map();
for (const row of towns.towns) {
  if (!RURAL_SUFFIX.test(row.n)) continue;
  const list = townsByCounty.get(row.c) || [];
  if (list.length >= MAX_TOWNS_PER_COUNTY) continue;
  const short = row.n.replace(STRIP_SUFFIX, "").trim();
  if (!short || short.length > 6) continue;
  if (list.includes(short)) continue;
  list.push(short);
  townsByCounty.set(row.c, list);
}

const byProvince = new Map();
for (const county of countyRows) {
  const townList = townsByCounty.get(county.code) || [];
  // 全是街道（纯城区）的区不进乡村地名表
  if (!townList.length) continue;
  const bucket = byProvince.get(county.provinceCode) || [];
  bucket.push([county.code, county.name, county.city, townList]);
  byProvince.set(county.provinceCode, bucket);
}

const provinces = core.provinces
  .filter((row) => byProvince.has(row.c))
  .map((row) => ({ code: row.c, name: row.n }));

const payload = {
  source: {
    provider: "uiwjs/province-city-china",
    sourceCommit: towns.source?.sourceCommit || core.source?.sourceCommit || "",
    license: "MIT",
    derivedAt: "2026-08-04",
    note: "仅保留乡/镇级真实地名，每县最多 5 条，用于村队命名与球场地名展示",
  },
  provinces,
  counties: Object.fromEntries([...byProvince.entries()].map(([code, list]) => [code, list])),
};

const outFile = resolve(projectRoot, "src/content/places-data.js");
mkdirSync(dirname(outFile), { recursive: true });
const body = `// 自动生成，请勿手改：node tools/sync-places.mjs
// 数据来源：uiwjs/province-city-china（MIT），仅取乡/镇级真实地名。
export const PLACES = ${JSON.stringify(payload)};
`;
writeFileSync(outFile, body, "utf8");

const countyCount = [...byProvince.values()].reduce((sum, list) => sum + list.length, 0);
const townCount = [...townsByCounty.values()].reduce((sum, list) => sum + list.length, 0);
console.log(`省级 ${provinces.length} 个，区县 ${countyCount} 个，乡镇地名 ${townCount} 条`);
console.log(`输出 ${outFile}（${(Buffer.byteLength(body) / 1024).toFixed(1)} KiB）`);
