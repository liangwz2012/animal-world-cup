// 队名用拟人动物（去真实国名，规避内容审核敏感项，同时兑现"动物"萌点）。
// id 保留英文键以对接引擎球衣/头像资源；animal 为物种描述备用。
const TEAMS = [
  { id: "england", name: "雄狮", animal: "狮子", color: 0xc54539 },
  { id: "france", name: "雄鸡", animal: "公鸡", color: 0x2858ad },
  { id: "germany", name: "黑鹰", animal: "黑鹰", color: 0x29231d },
  { id: "spain", name: "蛮牛", animal: "公牛", color: 0xc83f35 },
  { id: "portugal", name: "苍狼", animal: "狼", color: 0x176d49 },
  { id: "brazil", name: "美洲豹", animal: "美洲豹", color: 0xedcf49 },
  { id: "argentina", name: "美洲狮", animal: "美洲狮", color: 0x8ed3f3 },
  { id: "usa", name: "白头鹰", animal: "白头鹰", color: 0x263f7b },
];

const FORMATIONS = [
  { name: "2-3-1", spots: [[3, 2, "D"], [3, 6, "D"], [5, 1, "M"], [5, 4, "M"], [5, 7, "M"], [7, 4, "A"]] },
  { name: "3-2-1", spots: [[3, 1, "D"], [3, 4, "D"], [3, 7, "D"], [5, 2, "M"], [5, 6, "M"], [7, 4, "A"]] },
  { name: "2-2-2", spots: [[3, 2, "D"], [3, 6, "D"], [5, 2, "M"], [5, 6, "M"], [7, 2, "A"], [7, 6, "A"]] },
  { name: "3-1-2", spots: [[3, 1, "D"], [3, 4, "D"], [3, 7, "D"], [5, 4, "M"], [7, 2, "A"], [7, 6, "A"]] },
  { name: "1-3-2", spots: [[3, 4, "D"], [5, 1, "M"], [5, 4, "M"], [5, 7, "M"], [7, 2, "A"], [7, 6, "A"]] },
  { name: "2-1-3", spots: [[3, 2, "D"], [3, 6, "D"], [5, 4, "M"], [7, 1, "A"], [7, 4, "A"], [7, 7, "A"]] },
];

const DIFFICULTIES = [
  { value: 0, label: "简单" },
  { value: 1, label: "普通" },
  { value: 2, label: "困难" },
];

const TIMES = [
  { value: 4, label: "短" },
  { value: 6, label: "标准" },
  { value: 10, label: "长" },
];

function defaults() {
  return {
    redTeam: "argentina",
    blueTeam: "portugal",
    redFormation: FORMATIONS[0].name,
    blueFormation: FORMATIONS[1].name,
    side: "home",
    ai: 1,
    time: 6,
    mode: "ai",
    roomId: "",
  };
}

function byValue(items, value, key) {
  return items.some((item) => item[key] === value) ? value : items[0][key];
}

function normalizeConfig(input) {
  const base = Object.assign(defaults(), input || {});
  base.redTeam = byValue(TEAMS, base.redTeam, "id");
  base.blueTeam = byValue(TEAMS, base.blueTeam, "id");
  if (base.blueTeam === base.redTeam) {
    base.blueTeam = TEAMS.find((team) => team.id !== base.redTeam).id;
  }
  base.redFormation = byValue(FORMATIONS, base.redFormation, "name");
  base.blueFormation = byValue(FORMATIONS, base.blueFormation, "name");
  base.ai = byValue(DIFFICULTIES, Number(base.ai), "value");
  base.time = byValue(TIMES, Number(base.time), "value");
  base.side = base.side === "away" ? "away" : "home";
  base.mode = ["ai", "friend", "watch"].includes(base.mode) ? base.mode : "ai";
  base.roomId = typeof base.roomId === "string" ? base.roomId.trim().slice(0, 96) : "";
  return base;
}

function formation(name) {
  return FORMATIONS.find((item) => item.name === name) || FORMATIONS[0];
}

function cycle(items, value, key, direction) {
  const index = Math.max(0, items.findIndex((item) => item[key] === value));
  const next = (index + (direction || 1) + items.length) % items.length;
  return items[next][key];
}

module.exports = {
  TEAMS,
  FORMATIONS,
  DIFFICULTIES,
  TIMES,
  defaults,
  normalizeConfig,
  formation,
  cycle,
};
