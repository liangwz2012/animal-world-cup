// 用真实行政区划地名组建村队：省 → 区县 → 乡镇，队名即"县 + 乡镇 + 村队"。
// 球衣配色是村超式的高饱和撞色，号码印在球衣背后和短裤上。

import { PLACES } from "./places-data.js";
import { generateSquad, rolesForFormat } from "./people.js";
import { cultureFor, provinceStyle } from "./regions.js";
import { createPrng, hashSeed } from "../core/prng.js";

// 村超球衣：主色 + 副色 + 号码色 + 边条色。
// 命名一律用颜色本身，不蹭任何现实球队的配色标识。
export const KIT_PALETTES = Object.freeze([
  { id: "red-gold", label: "红金", primary: "#C3272B", secondary: "#F2E3C2", number: "#FFF3D6", trim: "#E8B11B", shorts: "#8E1A1E", socks: "#C3272B" },
  { id: "green-white", label: "翠绿", primary: "#2E7350", secondary: "#F5F0E1", number: "#FFFFFF", trim: "#E8B11B", shorts: "#1D4A34", socks: "#2E7350" },
  { id: "navy-sky", label: "藏青", primary: "#1F3F6B", secondary: "#DCE9F2", number: "#F2F7FF", trim: "#5FA8D3", shorts: "#152B4A", socks: "#1F3F6B" },
  { id: "orange-black", label: "橘黑", primary: "#D96A1E", secondary: "#2A2118", number: "#FFF0DA", trim: "#2A2118", shorts: "#2A2118", socks: "#D96A1E" },
  { id: "yellow-blue", label: "明黄", primary: "#E8B11B", secondary: "#22407A", number: "#22407A", trim: "#22407A", shorts: "#22407A", socks: "#E8B11B" },
  { id: "purple-cream", label: "紫米", primary: "#6B3B8F", secondary: "#F3E7CE", number: "#F7EEDF", trim: "#E8B11B", shorts: "#432257", socks: "#6B3B8F" },
  { id: "cyan-white", label: "湖蓝", primary: "#2E8FA8", secondary: "#F0F5F2", number: "#FFFFFF", trim: "#F0BC3F", shorts: "#1C5E70", socks: "#2E8FA8" },
  { id: "maroon-cream", label: "枣红", primary: "#7A2A2A", secondary: "#EFE0C4", number: "#F7E9CE", trim: "#C9A227", shorts: "#511A1A", socks: "#7A2A2A" },
  { id: "black-white", label: "黑白", primary: "#22242A", secondary: "#F2F2EE", number: "#FFFFFF", trim: "#F2F2EE", shorts: "#22242A", socks: "#22242A" },
  { id: "grass-orange", label: "草绿", primary: "#5F8A2A", secondary: "#F6EFD8", number: "#FFF8E4", trim: "#D96A1E", shorts: "#3F5C1C", socks: "#5F8A2A" },
]);

export const GOALKEEPER_KITS = Object.freeze([
  { id: "gk-lime", primary: "#B8D64A", secondary: "#2A3320", number: "#22301A", trim: "#2A3320", shorts: "#2A3320", socks: "#B8D64A" },
  { id: "gk-pink", primary: "#D6608A", secondary: "#3A1D2A", number: "#FFF0F4", trim: "#3A1D2A", shorts: "#3A1D2A", socks: "#D6608A" },
  { id: "gk-slate", primary: "#4A5C6B", secondary: "#E8EEF2", number: "#F2F7FA", trim: "#E8EEF2", shorts: "#33414D", socks: "#4A5C6B" },
]);

export function listProvinces() {
  return PLACES.provinces.map((p) => ({ ...p, style: provinceStyle(p.code) }));
}

export function countiesOf(provinceCode) {
  const rows = PLACES.counties[provinceCode] || [];
  return rows.map(([code, name, city, towns]) => ({ code, name, city, towns }));
}

export function findCounty(countyCode) {
  for (const [provinceCode, rows] of Object.entries(PLACES.counties)) {
    for (const [code, name, city, towns] of rows) {
      if (code === countyCode) return { provinceCode, code, name, city, towns };
    }
  }
  return null;
}

export function provinceNameOf(provinceCode) {
  return PLACES.provinces.find((p) => p.code === provinceCode)?.name || "";
}

function kitFor(seedText, avoidId) {
  const prng = createPrng(hashSeed(`kit:${seedText}`));
  const pool = KIT_PALETTES.filter((k) => k.id !== avoidId);
  return pool[Math.floor(prng.next() * pool.length) % pool.length];
}

function keeperKitFor(seedText) {
  const prng = createPrng(hashSeed(`gk:${seedText}`));
  return GOALKEEPER_KITS[Math.floor(prng.next() * GOALKEEPER_KITS.length) % GOALKEEPER_KITS.length];
}

// 村队队名：优先"乡镇名 + 村队"，同县重名时加县名前缀
export function createTeam({ provinceCode, countyCode, townIndex = 0, perSide = 5, avoidKitId = "" }) {
  const county = findCounty(countyCode) || countiesOf(provinceCode)[0];
  if (!county) throw new Error(`没有找到区县数据：${provinceCode}/${countyCode}`);
  const province = provinceNameOf(county.provinceCode || provinceCode);
  const town = county.towns[townIndex % county.towns.length] || county.name;
  const seedText = `${county.code}:${town}`;
  const kit = kitFor(seedText, avoidKitId);
  const culture = cultureFor(county.provinceCode || provinceCode);
  const squad = generateSquad({ seedText, roles: rolesForFormat(perSide), teamName: `${town}村队` });

  return {
    id: `${county.code}-${townIndex}`,
    name: `${town}村队`,
    shortName: town,
    fullName: `${province}${county.name}${town}村队`,
    place: {
      provinceCode: county.provinceCode || provinceCode,
      province,
      countyCode: county.code,
      county: county.name,
      city: county.city,
      town,
    },
    culture,
    kit,
    keeperKit: keeperKitFor(seedText),
    players: squad,
    banner: `${county.name}${town}  欢迎八方乡亲`,
    slogan: culture.cheer,
  };
}

// 同县或邻县的对手，保证"本地德比"的地名真实
export function createRivalTeam(homeTeam, { perSide = 5, offset = 1 } = {}) {
  const county = findCounty(homeTeam.place.countyCode);
  const provinceCounties = countiesOf(homeTeam.place.provinceCode);
  if (county && county.towns.length > 1) {
    const townIndex = (homeTeam.townIndex ?? 0) + offset;
    if (townIndex % county.towns.length !== (homeTeam.townIndex ?? 0)) {
      return createTeam({
        provinceCode: homeTeam.place.provinceCode,
        countyCode: county.code,
        townIndex,
        perSide,
        avoidKitId: homeTeam.kit.id,
      });
    }
  }
  const index = provinceCounties.findIndex((c) => c.code === homeTeam.place.countyCode);
  const next = provinceCounties[(index + offset) % provinceCounties.length] || provinceCounties[0];
  return createTeam({
    provinceCode: homeTeam.place.provinceCode,
    countyCode: next.code,
    townIndex: 0,
    perSide,
    avoidKitId: homeTeam.kit.id,
  });
}

// 默认主场：黔东南榕江，村超的原点
export const DEFAULT_HOME = Object.freeze({ provinceCode: "520000", countyCode: "522632", townIndex: 0 });

export function defaultMatchup(perSide = 5) {
  const home = createTeam({ ...DEFAULT_HOME, perSide });
  home.townIndex = DEFAULT_HOME.townIndex;
  const away = createRivalTeam(home, { perSide, offset: 1 });
  return { home, away };
}

export function randomCountyOf(provinceCode, seedText) {
  const list = countiesOf(provinceCode);
  const prng = createPrng(hashSeed(seedText || provinceCode));
  return list[Math.floor(prng.next() * list.length) % list.length];
}
