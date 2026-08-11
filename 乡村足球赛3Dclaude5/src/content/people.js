// 村超球员生成：长相、身材、年龄、职业、号码全部由地区 + 号码稳定派生。
// 目标是"村里那帮人"而不是职业运动员——有中年发福的屠户，也有瘦得像竹竿的返乡学生。
// 说明：所有人名均为虚构组合，不指向任何真实球员。

import { createPrng, hashSeed } from "../core/prng.js";
import { clamp } from "../core/mathx.js";

const SURNAMES = [
  "王", "李", "张", "刘", "陈", "杨", "黄", "赵", "吴", "周",
  "徐", "孙", "马", "朱", "胡", "郭", "何", "林", "罗", "郑",
  "梁", "谢", "宋", "唐", "许", "韩", "冯", "邓", "曹", "彭",
  "曾", "肖", "田", "董", "袁", "潘", "蒋", "蔡", "余", "杜",
  "石", "覃", "韦", "蒙", "岑", "陆", "莫", "班", "麻", "龙",
];

// 不同年龄段的用字习惯不同：五十岁的叫"国强""建军"，二十岁的叫"梓航""俊杰"
const GIVEN_OLD = ["国强", "建军", "德福", "长顺", "水生", "永富", "有才", "文昌", "大田", "金山", "老四", "铁柱", "在贵", "万年"];
const GIVEN_MIDDLE = ["志强", "小军", "卫东", "春林", "海波", "红兵", "满堂", "松柏", "开明", "成龙", "亚东", "光辉"];
const GIVEN_YOUNG = ["俊杰", "浩然", "子豪", "文博", "小满", "跃进", "阿宝", "少华", "梓航", "宇轩", "书鹏", "家伟"];
const GIVEN_WOMEN = ["春花", "秀丽", "月娥", "桂香", "小妹", "美玲", "彩云", "亚男", "晓芳", "水莲", "婷婷", "永梅"];

const VOCATIONS = [
  { id: "farmer", label: "种植大户", ageBias: 0.6, power: 0.12, stamina: 0.1 },
  { id: "butcher", label: "屠户", ageBias: 0.7, power: 0.22, stamina: -0.12 },
  { id: "rider", label: "外卖骑手", ageBias: 0.2, pace: 0.18, stamina: 0.14 },
  { id: "steelworker", label: "钢筋工", ageBias: 0.45, power: 0.2, guts: 0.12 },
  { id: "teacher", label: "乡校老师", ageBias: 0.4, control: 0.16, guts: 0.08 },
  { id: "student", label: "返乡大学生", ageBias: 0.05, pace: 0.2, control: 0.1, power: -0.12 },
  { id: "shopkeeper", label: "小卖部老板", ageBias: 0.65, control: 0.08, pace: -0.14 },
  { id: "driver", label: "拖拉机手", ageBias: 0.55, power: 0.14, pace: -0.08 },
  { id: "cook", label: "红白喜事厨子", ageBias: 0.6, power: 0.16, stamina: -0.1 },
  { id: "doctor", label: "村医", ageBias: 0.5, control: 0.12, guts: 0.14 },
  { id: "fisher", label: "养鱼户", ageBias: 0.5, stamina: 0.16, power: 0.06 },
  { id: "carpenter", label: "木匠", ageBias: 0.6, power: 0.14, control: 0.08 },
  { id: "mechanic", label: "汽修学徒", ageBias: 0.12, pace: 0.14, guts: 0.1 },
  { id: "tea-picker", label: "采茶工", ageBias: 0.45, stamina: 0.18, pace: 0.06 },
  { id: "herder", label: "放牛人", ageBias: 0.5, stamina: 0.2, guts: 0.06 },
  { id: "mason", label: "泥水匠", ageBias: 0.55, power: 0.18, stamina: 0.08 },
];

// 身材原型：这些数值直接驱动 3D 骨骼长度与体块半径，不是标签
export const BODY_ARCHETYPES = Object.freeze({
  "lean-farmhand": {
    id: "lean-farmhand", label: "精瘦农活型",
    height: 1.68, shoulder: 0.94, chest: 0.9, belly: 0.82, limb: 0.86, legRatio: 1.03, neck: 0.92,
    weightHint: 58, attr: { pace: 0.1, stamina: 0.16, power: -0.1 },
  },
  "stocky-butcher": {
    id: "stocky-butcher", label: "壮实屠户型",
    height: 1.7, shoulder: 1.16, chest: 1.18, belly: 1.3, limb: 1.16, legRatio: 0.95, neck: 1.15,
    weightHint: 88, attr: { power: 0.2, pace: -0.14, stamina: -0.12 },
  },
  "tall-youth": {
    id: "tall-youth", label: "高瘦青年",
    height: 1.82, shoulder: 0.98, chest: 0.93, belly: 0.85, limb: 0.9, legRatio: 1.09, neck: 0.95,
    weightHint: 66, attr: { pace: 0.16, control: 0.06, power: -0.08 },
  },
  "compact-strong": {
    id: "compact-strong", label: "矮壮结实型",
    height: 1.62, shoulder: 1.12, chest: 1.1, belly: 1.02, limb: 1.1, legRatio: 0.94, neck: 1.08,
    weightHint: 74, attr: { power: 0.16, guts: 0.12, pace: -0.04 },
  },
  "middle-belly": {
    id: "middle-belly", label: "中年发福型",
    height: 1.71, shoulder: 1.06, chest: 1.08, belly: 1.42, limb: 1.06, legRatio: 0.96, neck: 1.1,
    weightHint: 84, attr: { power: 0.1, stamina: -0.2, control: 0.08 },
  },
  "wiry-veteran": {
    id: "wiry-veteran", label: "干瘦老将",
    height: 1.65, shoulder: 0.92, chest: 0.88, belly: 0.86, limb: 0.84, legRatio: 1, neck: 0.9,
    weightHint: 56, attr: { control: 0.16, pace: -0.16, guts: 0.14 },
  },
  "athletic-woman": {
    id: "athletic-woman", label: "女足队员",
    height: 1.64, shoulder: 0.9, chest: 0.94, belly: 0.88, limb: 0.88, legRatio: 1.05, neck: 0.88,
    female: true, weightHint: 55, attr: { pace: 0.12, control: 0.14, power: -0.12 },
  },
  "teen-student": {
    id: "teen-student", label: "少年学生型",
    height: 1.6, shoulder: 0.86, chest: 0.84, belly: 0.82, limb: 0.8, legRatio: 1.06, neck: 0.86,
    weightHint: 50, attr: { pace: 0.14, stamina: 0.08, power: -0.2, guts: -0.08 },
  },
  "big-keeper": {
    id: "big-keeper", label: "高大门将型",
    height: 1.86, shoulder: 1.14, chest: 1.12, belly: 1.02, limb: 1.08, legRatio: 1.02, neck: 1.12,
    weightHint: 86, attr: { guts: 0.2, power: 0.14, pace: -0.1 },
  },
});

const ARCHETYPE_IDS = Object.keys(BODY_ARCHETYPES);

// 常年在太阳下踢球的肤色区间：偏红棕，脖子以下有明显的 T 恤晒痕
const SKIN_TONES = ["#C98F63", "#BC7F52", "#AE7047", "#D3A177", "#9E603C", "#C58A5C", "#B37A50", "#8F5636"];
const HAIR_COLORS = ["#17110C", "#241A12", "#0F0B08", "#3A2A1C", "#4A4A48", "#6E6A64", "#8A867E"];
const HAIR_STYLES = ["buzz", "short", "flat-top", "side-part", "messy", "bald-top", "ponytail", "bun", "headband"];

const ROLE_ATTR_BIAS = {
  G: { guts: 0.22, control: 0.06, pace: -0.12, power: 0.06 },
  D: { power: 0.14, guts: 0.12, control: -0.04 },
  M: { stamina: 0.16, control: 0.14 },
  A: { pace: 0.16, power: 0.08, control: 0.06 },
};

function pickWeighted(prng, list) {
  return list[Math.floor(prng.next() * list.length) % list.length];
}

function archetypeForRole(prng, role, age) {
  if (role === "G") return prng.chance(0.55) ? "big-keeper" : prng.chance(0.5) ? "stocky-butcher" : "compact-strong";
  if (age >= 45) return prng.chance(0.5) ? "middle-belly" : "wiry-veteran";
  if (age <= 19) return prng.chance(0.6) ? "teen-student" : "tall-youth";
  const pool = ["lean-farmhand", "compact-strong", "tall-youth", "stocky-butcher", "middle-belly", "athletic-woman"];
  return pickWeighted(prng, pool);
}

function ageForRole(prng, role, index) {
  // 村队年龄分布：主峰在 24~34 岁，两端各留出少年和老将的长尾
  const a = prng.next();
  const b = prng.next();
  const bell = (a + b) / 2; // 三角分布，中间厚两头薄
  const base = Math.round(17 + bell * 36);
  if (role === "G" && base < 24) return base + 7;
  if (index === 0) return clamp(base + 8, 28, 58);
  return clamp(base, 16, 56);
}

function givenNameFor(prng, age, female) {
  if (female) return pickWeighted(prng, GIVEN_WOMEN);
  if (age >= 45) return pickWeighted(prng, GIVEN_OLD);
  if (age >= 30) return pickWeighted(prng, GIVEN_MIDDLE);
  return pickWeighted(prng, GIVEN_YOUNG);
}

function hairFor(prng, age, female, archetype) {
  if (female) return prng.chance(0.55) ? "ponytail" : prng.chance(0.5) ? "bun" : "short";
  if (age >= 48) return prng.chance(0.45) ? "bald-top" : prng.chance(0.5) ? "flat-top" : "short";
  if (archetype === "teen-student") return prng.chance(0.5) ? "buzz" : "messy";
  return pickWeighted(prng, HAIR_STYLES.slice(0, 6));
}

// 号码规则：门将 1 号或 12 号，其余按位置分段，和真实村队一样有 7、9、10 这类"心头号"
function numbersFor(prng, count) {
  const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 20, 21, 22, 23, 25, 27, 30, 33, 66, 77, 88, 99];
  const chosen = [1];
  const rest = pool.slice(1);
  while (chosen.length < count && rest.length) {
    const index = Math.floor(prng.next() * rest.length) % rest.length;
    chosen.push(rest.splice(index, 1)[0]);
  }
  return chosen;
}

export function generateSquad({ seedText, roles, teamName }) {
  const prng = createPrng(hashSeed(`squad:${seedText}`));
  const numbers = numbersFor(prng, roles.length);
  return roles.map((role, index) => {
    const age = ageForRole(prng, role, index);
    const archetypeId = archetypeForRole(prng, role, age);
    const archetype = BODY_ARCHETYPES[archetypeId];
    const female = Boolean(archetype.female);
    const vocationPool = VOCATIONS.filter((v) => Math.abs(v.ageBias - clamp((age - 18) / 40, 0, 1)) < 0.42);
    const vocation = pickWeighted(prng, vocationPool.length ? vocationPool : VOCATIONS);
    const surname = pickWeighted(prng, SURNAMES);
    const given = givenNameFor(prng, age, female);
    const hair = hairFor(prng, age, female, archetypeId);

    // 年龄曲线：25~32 岁是顶点，18 岁和 50 岁两端都下降，但老将的"控"和"胆"更高
    const peak = 1 - Math.min(1, Math.abs(age - 28) / 26) * 0.34;
    const roleBias = ROLE_ATTR_BIAS[role] || {};
    const attr = {};
    for (const key of ["pace", "power", "control", "stamina", "guts"]) {
      const base = 0.42 + prng.next() * 0.3;
      const value = base * peak + (archetype.attr[key] || 0) + (roleBias[key] || 0) + (vocation[key] || 0);
      attr[key] = clamp(value, 0.16, 0.98);
    }
    if (age >= 45) {
      attr.control = clamp(attr.control + 0.1, 0.16, 0.98);
      attr.guts = clamp(attr.guts + 0.08, 0.16, 0.98);
      attr.stamina = clamp(attr.stamina - 0.12, 0.12, 0.9);
    }

    return {
      id: `${seedText}-${index}`,
      name: `${surname}${given}`,
      number: numbers[index],
      role,
      age,
      female,
      vocation: vocation.label,
      vocationId: vocation.id,
      archetype: archetypeId,
      // 同一原型也要有个体差异：身高 ±4 cm，肩宽/肚子/四肢各 ±6%，避免"克隆村"
      body: {
        ...archetype,
        height: Number((archetype.height + prng.signed(0.04)).toFixed(3)),
        shoulder: Number((archetype.shoulder * (1 + prng.signed(0.06))).toFixed(3)),
        chest: Number((archetype.chest * (1 + prng.signed(0.05))).toFixed(3)),
        belly: Number((archetype.belly * (1 + prng.signed(0.07) + (age > 38 ? 0.06 : 0))).toFixed(3)),
        limb: Number((archetype.limb * (1 + prng.signed(0.05))).toFixed(3)),
        legRatio: Number((archetype.legRatio * (1 + prng.signed(0.025))).toFixed(3)),
      },
      look: {
        skin: pickWeighted(prng, SKIN_TONES),
        hair: pickWeighted(prng, age >= 48 ? HAIR_COLORS.slice(3) : HAIR_COLORS.slice(0, 4)),
        hairStyle: hair,
        // 晒痕：短袖以下明显更黑，这是村超球员最直观的特征之一
        tanLine: 0.45 + prng.next() * 0.45,
        stubble: !female && age >= 26 ? prng.next() * 0.8 : 0,
        wrinkle: clamp((age - 30) / 30, 0, 1),
        brow: prng.next(),
        eyeGap: 0.9 + prng.next() * 0.2,
        headband: prng.chance(age < 35 ? 0.16 : 0.06),
        kneeStrap: prng.chance(age > 40 ? 0.3 : 0.08),
        sleeveRoll: prng.chance(0.35),
        sockDown: prng.chance(0.28),
      },
      ...attr,
      label: `${age} 岁 · ${vocation.label}`,
      teamName,
    };
  });
}

export function rolesForFormat(perSide) {
  if (perSide >= 7) return ["G", "D", "D", "D", "M", "M", "A"];
  return ["G", "D", "D", "M", "A"];
}

export function describePlayer(player) {
  return `${player.number} 号 ${player.name}（${player.age} 岁 ${player.vocation}）`;
}
