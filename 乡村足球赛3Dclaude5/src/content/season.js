// 村寨杯：用真实地名排一张四轮晋级表——本乡镇 → 邻乡 → 邻县 → 州府。
// 进度存在本地，输了就止步，赢到底给一个"捧杯"结算。

import { countiesOf, createRivalTeam, createTeam, provinceNameOf } from "./teams.js";
import { createPrng, hashSeed } from "../core/prng.js";

export const CUP_ROUNDS = Object.freeze([
  { id: "village", label: "乡邻杯", detail: "同乡镇的老对手", offset: 1, difficulty: "easy" },
  { id: "town", label: "乡镇赛", detail: "邻乡的硬骨头", offset: 2, difficulty: "normal" },
  { id: "county", label: "县域争霸", detail: "隔壁县的强队", offset: 5, difficulty: "normal" },
  { id: "prefecture", label: "州府决赛", detail: "全州最能踢的一支", offset: 11, difficulty: "hard" },
]);

export function createCup({ provinceCode, countyCode, townIndex, perSide }) {
  const home = createTeam({ provinceCode, countyCode, townIndex, perSide });
  home.townIndex = townIndex;
  const prng = createPrng(hashSeed(`cup:${countyCode}:${townIndex}`));
  const counties = countiesOf(provinceCode);
  const baseIndex = Math.max(0, counties.findIndex((c) => c.code === countyCode));

  const rounds = CUP_ROUNDS.map((round, index) => {
    let opponent;
    if (index < 2) {
      opponent = createRivalTeam(home, { perSide, offset: round.offset });
    } else {
      const target = counties[(baseIndex + round.offset + Math.floor(prng.next() * 3)) % counties.length];
      opponent = createTeam({
        provinceCode,
        countyCode: target.code,
        townIndex: Math.floor(prng.next() * 5),
        perSide,
        avoidKitId: home.kit.id,
      });
    }
    return { ...round, opponentId: opponent.id, opponent };
  });

  return {
    id: `${countyCode}-${townIndex}-${perSide}`,
    province: provinceNameOf(provinceCode),
    home,
    rounds,
    index: 0,
    wins: 0,
    finished: false,
    champion: false,
  };
}

export function currentRound(cup) {
  return cup.rounds[Math.min(cup.index, cup.rounds.length - 1)];
}

export function advanceCup(cup, won) {
  if (won) {
    cup.wins += 1;
    cup.index += 1;
    if (cup.index >= cup.rounds.length) {
      cup.finished = true;
      cup.champion = true;
    }
  } else {
    cup.finished = true;
    cup.champion = false;
  }
  return cup;
}

export function cupSummary(cup) {
  const round = currentRound(cup);
  if (cup.finished) {
    return cup.champion ? `${cup.home.shortName}村队捧起村寨杯！` : `止步${round.label}`;
  }
  return `${round.label} · 对手 ${round.opponent.place.county}${round.opponent.shortName}村队`;
}

export function cupProgress(cup) {
  return { index: cup.index, total: cup.rounds.length, wins: cup.wins, finished: cup.finished, champion: cup.champion };
}
