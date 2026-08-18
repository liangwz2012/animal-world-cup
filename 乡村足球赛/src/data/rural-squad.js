// 一支乡村队的完整 12 人名单。职业用于角色气质，比赛时统一穿本队球衣。
// bodyProfile 只控制 Spine 视觉根节点，不参与速度、碰撞、AI 或击球判定。
const RURAL_SQUAD = [
  { id: "butcher-captain", name: "韦国强", age: 45, vocation: "屠户", role: "G", number: 1, label: "村队老队长", bodyProfile: "large" },
  { id: "sugarcane-defender", name: "蒙大田", age: 40, vocation: "种植大户", role: "D", number: 2, label: "稳健后卫", bodyProfile: "compact-strong" },
  { id: "pe-teacher-defender", name: "覃秀丽", age: 32, vocation: "体育老师", role: "D", number: 3, label: "体育老师", bodyProfile: "balanced" },
  { id: "rider-winger", name: "吴跃进", age: 24, vocation: "外卖骑手", role: "D", number: 4, label: "骑手边卫", bodyProfile: "tall-slim" },
  { id: "steelworker-midfielder", name: "石铁柱", age: 29, vocation: "钢筋工", role: "M", number: 5, label: "钢筋中场", bodyProfile: "tall-strong" },
  { id: "noodle-playmaker", name: "岑月娥", age: 31, vocation: "米粉店主", role: "M", number: 6, label: "组织核心", bodyProfile: "balanced" },
  { id: "shopkeeper-midfielder", name: "罗桂香", age: 47, vocation: "小卖部账房", role: "M", number: 7, label: "经验后腰", bodyProfile: "compact-strong" },
  { id: "graduate-forward", name: "杨帆", age: 21, vocation: "返乡大学生", role: "A", number: 8, label: "返乡前锋", bodyProfile: "tall-slim" },
  { id: "woman-striker", name: "韦春花", age: 25, vocation: "女足尖子", role: "A", number: 9, label: "女足前锋", bodyProfile: "balanced" },
  { id: "market-winger", name: "陆小妹", age: 26, vocation: "卤味摊主", role: "A", number: 10, label: "活力边锋", bodyProfile: "compact-strong" },
  { id: "doctor-goalkeeper", name: "何济民", age: 36, vocation: "村医", role: "G", number: 11, label: "替补门将", bodyProfile: "tall-strong" },
  { id: "mechanic-apprentice", name: "梁小满", age: 18, vocation: "汽修学徒", role: "M", number: 12, label: "年轻替补", bodyProfile: "tall-slim" },
  { id: "fishpond-farmer", name: "何水生", age: 50, vocation: "养鱼户", role: "M", number: 13, label: "养殖中场", bodyProfile: "compact-strong" },
  { id: "bamboo-craftsman", name: "梁师傅", age: 58, vocation: "竹编师傅", role: "M", number: 14, label: "老师傅", bodyProfile: "tall-slim" },
];

const RURAL_RACE_PREFIX = "rural_";
const RURAL_GOLD_STANDARD_RACE_ID = "rural_v2_01";
// 首页左右各展示 6 名球员。两组覆盖完整 12 人且互不重复；每组都有门将、
// 后卫、中场和前锋，地区变化只换队名/球衣，不再用地区哈希把双方人物轮换重叠。
const RURAL_MATCH_LINEUP_INDEXES = Object.freeze({
  red: Object.freeze([0, 1, 2, 4, 7, 8]),
  blue: Object.freeze([10, 3, 5, 6, 9, 11]),
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

function ruralPlayersForSide(side) {
  const indexes = RURAL_MATCH_LINEUP_INDEXES[side === "blue" ? "blue" : "red"];
  return indexes.map((index) => {
    const player = RURAL_SQUAD[index];
    return {
      id: player.id,
      name: player.name,
      role: player.role,
      number: player.number,
      race: ruralRaceId(index + 1),
      skin: {},
    };
  });
}

module.exports = {
  RURAL_GOLD_STANDARD_RACE_ID,
  RURAL_MATCH_LINEUP_INDEXES,
  RURAL_SQUAD,
  RURAL_RACE_PREFIX,
  legacyRuralRaceId,
  ruralRaceId,
  ruralPlayers,
  ruralPlayersForSide,
};
