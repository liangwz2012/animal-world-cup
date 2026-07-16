// 主名用拟人动物(name)、副标题显示国名(country)、国旗已隐藏。
// id 保留英文键以对接引擎球衣/头像资源；animal 为物种描述备用。
const TEAMS = [
  { id: "england", name: "雄狮", country: "英格兰", animal: "狮子", color: 0xc54539 },
  { id: "france", name: "雄鸡", country: "法国", animal: "公鸡", color: 0x2858ad },
  { id: "germany", name: "黑鹰", country: "德国", animal: "黑鹰", color: 0x29231d },
  { id: "spain", name: "蛮牛", country: "西班牙", animal: "公牛", color: 0xc83f35 },
  { id: "portugal", name: "苍狼", country: "葡萄牙", animal: "狼", color: 0x176d49 },
  { id: "brazil", name: "美洲豹", country: "巴西", animal: "美洲豹", color: 0xedcf49 },
  { id: "argentina", name: "美洲狮", country: "阿根廷", animal: "美洲狮", color: 0x8ed3f3 },
  { id: "usa", name: "白头鹰", country: "美国", animal: "白头鹰", color: 0x263f7b },
];

// 已随包发布（已过审）的默认队列快照，作为远程配置的兜底基线。
const DEFAULT_TEAMS = TEAMS.map((team) => Object.assign({}, team));

function parseColor(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value >>> 0;
  if (typeof value === "string") {
    const hex = value.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return parseInt(hex, 16);
  }
  return null;
}

// 远程只能覆盖"已随包发布"的队伍的 名字/动物/颜色/启用/排序，
// 不接受本地不存在的新 id —— 从代码层堵住"云端下发未审核新内容"的合规红线。
// 任何非法或有效队伍不足 2 支的配置一律忽略，回落到本地已审核默认队列。
function applyTeamOverrides(remoteTeams) {
  if (!Array.isArray(remoteTeams) || remoteTeams.length === 0) return false;
  const byId = new Map();
  for (const item of remoteTeams) {
    if (item && typeof item.id === "string") byId.set(item.id, item);
  }
  const merged = DEFAULT_TEAMS.map((base, index) => {
    const patch = byId.get(base.id) || {};
    const next = Object.assign({}, base);
    if (typeof patch.name === "string" && patch.name.trim()) next.name = patch.name.trim().slice(0, 12);
    if (typeof patch.country === "string" && patch.country.trim()) next.country = patch.country.trim().slice(0, 12);
    if (typeof patch.animal === "string" && patch.animal.trim()) next.animal = patch.animal.trim().slice(0, 12);
    const color = parseColor(patch.color);
    if (color != null) next.color = color;
    next.enabled = patch.enabled !== false;
    next.order = Number.isFinite(patch.order) ? patch.order : index;
    return next;
  });
  const active = merged
    .filter((team) => team.enabled)
    .sort((a, b) => a.order - b.order);
  if (active.length < 2) return false;
  TEAMS.length = 0;
  for (const team of active) {
    TEAMS.push({ id: team.id, name: team.name, country: team.country, animal: team.animal, color: team.color });
  }
  return true;
}

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
    ai: 0,
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
  DEFAULT_TEAMS,
  FORMATIONS,
  DIFFICULTIES,
  TIMES,
  defaults,
  normalizeConfig,
  formation,
  cycle,
  applyTeamOverrides,
};
