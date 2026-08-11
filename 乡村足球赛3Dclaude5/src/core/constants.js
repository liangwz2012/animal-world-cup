// 比赛核心常量。所有单位为米、秒、弧度。
// 场地按村寨球场的实际观感取值：比职业场小一圈，边线离房屋近，观众贴着铁网。

export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

export const FORMATS = Object.freeze({
  "5v5": Object.freeze({
    id: "5v5",
    label: "5 人制（村寨常规）",
    perSide: 5,
    pitch: Object.freeze({ length: 52, width: 34 }),
    goal: Object.freeze({ width: 5, height: 2 }),
    penaltyDepth: 11,
    penaltyWidth: 18,
    halfSeconds: 150,
  }),
  "7v7": Object.freeze({
    id: "7v7",
    label: "7 人制（乡镇杯）",
    perSide: 7,
    pitch: Object.freeze({ length: 64, width: 42 }),
    goal: Object.freeze({ width: 6, height: 2.2 }),
    penaltyDepth: 13,
    penaltyWidth: 22,
    halfSeconds: 180,
  }),
});

export const BALL = Object.freeze({
  radius: 0.112,
  mass: 0.43,
  gravity: 9.81,
  airDrag: 0.32, // 与速度平方成正比的空气阻力系数（已按质量折算）
  rollDrag: 0.86, // 草地滚动阻尼，泥地天气会再乘一个系数
  bounce: 0.52,
  spinDecay: 1.6,
  magnus: 0.011,
  restSpeed: 0.14,
});

export const PLAYER = Object.freeze({
  radius: 0.34,
  // 村超球员不是职业运动员：最快也就 7 m/s 出头，体力掉得快、恢复慢
  baseSpeed: 4.6,
  sprintBonus: 1.9,
  accel: 11,
  decel: 15,
  turnRate: 7.2,
  controlRadius: 1.05,
  reachRadius: 1.5,
  tackleRadius: 1.55,
  headerHeight: Object.freeze({ min: 1.35, max: 2.35 }),
  staminaDrain: Object.freeze({ run: 0.9, sprint: 4.2, idle: -2.4 }),
});

export const MATCH_PHASE = Object.freeze({
  KICKOFF: "kickoff",
  PLAY: "play",
  THROW_IN: "throw-in",
  GOAL_KICK: "goal-kick",
  CORNER: "corner",
  FREE_KICK: "free-kick",
  PENALTY: "penalty",
  GOAL: "goal",
  HALF_TIME: "half-time",
  FULL_TIME: "full-time",
});

export const ACTION = Object.freeze({
  PASS: "pass",
  THROUGH: "through",
  CROSS: "cross",
  SHOT: "shot",
  TACKLE: "tackle",
  SLIDE: "slide",
  SPRINT: "sprint",
  SWITCH: "switch",
  SKILL: "skill",
});

// 球员状态机：渲染层的动作合成完全由这里驱动，不允许渲染层自己造状态
export const PSTATE = Object.freeze({
  IDLE: "idle",
  RUN: "run",
  SPRINT: "sprint",
  DRIBBLE: "dribble",
  PASS: "pass",
  SHOOT: "shoot",
  TACKLE: "tackle",
  SLIDE: "slide",
  HEADER: "header",
  TRAP: "trap",
  FALL: "fall",
  GETUP: "getup",
  DIVE: "dive",
  THROW: "throw",
  CELEBRATE: "celebrate",
  SKILL: "skill",
});

export const WEATHER = Object.freeze({
  clear: Object.freeze({ id: "clear", label: "晴", rollFactor: 1, gripFactor: 1, windX: 0, windZ: 0 }),
  dusk: Object.freeze({ id: "dusk", label: "黄昏", rollFactor: 1, gripFactor: 1, windX: 0.25, windZ: 0.1 }),
  night: Object.freeze({ id: "night", label: "夜灯", rollFactor: 1.02, gripFactor: 0.98, windX: 0, windZ: 0 }),
  rain: Object.freeze({ id: "rain", label: "雨后泥地", rollFactor: 1.12, gripFactor: 0.86, windX: 0.4, windZ: -0.3 }),
  wind: Object.freeze({ id: "wind", label: "山风", rollFactor: 1, gripFactor: 0.96, windX: 0.9, windZ: 0.6 }),
});
