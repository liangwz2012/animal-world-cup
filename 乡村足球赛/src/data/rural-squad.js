// 一支乡村队的完整 12 人名单。职业用于角色气质，比赛时统一穿本队球衣。
// bodyProfile 只控制 Spine 视觉根节点，不参与速度、碰撞、AI 或击球判定。
const RURAL_SQUAD = [
  { id: "butcher-captain", name: "韦国强", age: 44, vocation: "屠户", role: "G", number: 1, label: "老练门将", bodyProfile: "large" },
  { id: "sugarcane-defender", name: "蒙大田", age: 40, vocation: "种植大户", role: "D", number: 2, label: "稳健后卫", bodyProfile: "compact-strong" },
  { id: "pe-teacher-defender", name: "覃秀丽", age: 32, vocation: "体育老师", role: "D", number: 3, label: "体育老师", bodyProfile: "balanced" },
  { id: "rider-winger", name: "吴跃进", age: 24, vocation: "外卖骑手", role: "D", number: 4, label: "骑手边卫", bodyProfile: "tall-slim" },
  { id: "steelworker-midfielder", name: "石铁柱", age: 29, vocation: "钢筋工", role: "M", number: 5, label: "钢筋中场", bodyProfile: "tall-strong" },
  { id: "noodle-playmaker", name: "岑月娥", age: 31, vocation: "米粉店主", role: "M", number: 6, label: "组织核心", bodyProfile: "balanced" },
  { id: "shopkeeper-midfielder", name: "罗桂香", age: 47, vocation: "小卖部老板", role: "M", number: 7, label: "经验后腰", bodyProfile: "compact-strong" },
  { id: "graduate-forward", name: "杨帆", age: 30, vocation: "返乡大学生", role: "A", number: 8, label: "返乡队长", bodyProfile: "tall-slim" },
  { id: "woman-striker", name: "韦春花", age: 25, vocation: "女足球员", role: "A", number: 9, label: "女足前锋", bodyProfile: "balanced" },
  { id: "market-winger", name: "陆小妹", age: 26, vocation: "卤味摊主", role: "M", number: 10, label: "活力中场", bodyProfile: "compact-strong" },
  { id: "doctor-goalkeeper", name: "何济民", age: 36, vocation: "村医", role: "G", number: 11, label: "替补门将", bodyProfile: "tall-strong" },
  { id: "mechanic-apprentice", name: "梁小满", age: 18, vocation: "汽修学徒", role: "D", number: 12, label: "年轻后卫", bodyProfile: "tall-slim" },
  { id: "fishpond-farmer", name: "何水生", age: 50, vocation: "养鱼户", role: "D", number: 13, label: "强壮后卫", bodyProfile: "compact-strong" },
  { id: "bamboo-craftsman", name: "梁师傅", age: 58, vocation: "竹编师傅", role: "M", number: 14, label: "老师傅", bodyProfile: "tall-slim" },
];

const RURAL_RACE_PREFIX = "rural_";
const RURAL_GOLD_STANDARD_RACE_ID = "rural_v2_01";
// 比赛双方使用互不重复的 7 人名单；首页各展示其中 6 人。返乡大学生是主队
// 第一视觉主角，但真实比赛仍保留门将、后卫、中场和前锋的完整位置结构。
const RURAL_MATCH_LINEUP_INDEXES = Object.freeze({
  red: Object.freeze([0, 1, 2, 4, 5, 6, 7]),
  blue: Object.freeze([10, 3, 11, 12, 9, 13, 8]),
});
const RURAL_HOME_LINEUP_INDEXES = Object.freeze({
  red: Object.freeze([7, 0, 1, 2, 6, 5]),
  blue: Object.freeze([3, 10, 11, 12, 9, 8]),
});

function legacyRuralRaceId(index) {
  const numeric = Number(index);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > RURAL_SQUAD.length) return "";
  return `${RURAL_RACE_PREFIX}${String(numeric).padStart(2, "0")}`;
}

function ruralRaceId(index) {
  const legacy = legacyRuralRaceId(index);
  if (!legacy) return "";
  return Number(index) === 1 ? RURAL_GOLD_STANDARD_RACE_ID : legacy;
}

function ruralPlayers() {
  return RURAL_SQUAD.map((player, index) => ({
    race: ruralRaceId(index + 1),
    role: player.role,
    number: player.number,
    skin: {},
  }));
}

function playersAtIndexes(indexes) {
  return indexes.map((index) => {
    const player = RURAL_SQUAD[index];
    return {
      id: player.id,
      name: player.name,
      vocation: player.vocation,
      role: player.role,
      number: player.number,
      race: ruralRaceId(index + 1),
      skin: {},
    };
  });
}

function ruralMatchPlayersForSide(side) {
  return playersAtIndexes(RURAL_MATCH_LINEUP_INDEXES[side === "blue" ? "blue" : "red"]);
}

function ruralPlayersForSide(side) {
  return playersAtIndexes(RURAL_HOME_LINEUP_INDEXES[side === "blue" ? "blue" : "red"]);
}

module.exports = {
  RURAL_GOLD_STANDARD_RACE_ID,
  RURAL_HOME_LINEUP_INDEXES,
  RURAL_MATCH_LINEUP_INDEXES,
  RURAL_SQUAD,
  RURAL_RACE_PREFIX,
  legacyRuralRaceId,
  ruralRaceId,
  ruralPlayers,
  ruralMatchPlayersForSide,
  ruralPlayersForSide,
};
