// 球员运动与状态机。渲染层读取 state/stateT/anim 合成动作，不自己判断。

import { PLAYER, PSTATE } from "./constants.js";
import { clamp, length2, moveToward, turnToward, wrapAngle } from "./mathx.js";

// 各状态的"锁定时长"：这段时间内玩家输入不能打断（真实的动作有惯性和收尾）
const STATE_LOCK = Object.freeze({
  [PSTATE.PASS]: 0.28,
  [PSTATE.SHOOT]: 0.46,
  [PSTATE.TACKLE]: 0.42,
  [PSTATE.SLIDE]: 0.95,
  [PSTATE.HEADER]: 0.62,
  [PSTATE.TRAP]: 0.22,
  [PSTATE.FALL]: 0.9,
  [PSTATE.GETUP]: 0.65,
  [PSTATE.DIVE]: 1.1,
  [PSTATE.THROW]: 0.5,
  [PSTATE.SKILL]: 0.5,
  [PSTATE.CELEBRATE]: 2.4,
});

export function createPlayer(spec) {
  return {
    id: spec.id,
    side: spec.side,
    index: spec.index,
    number: spec.number,
    name: spec.name,
    role: spec.role, // G/D/M/A
    // 村民属性：0~1。老屠户力量大但耐力差，返乡大学生快但对抗弱
    attr: {
      pace: clamp(spec.pace ?? 0.6, 0.15, 1),
      power: clamp(spec.power ?? 0.6, 0.15, 1),
      control: clamp(spec.control ?? 0.6, 0.15, 1),
      stamina: clamp(spec.stamina ?? 0.6, 0.15, 1),
      guts: clamp(spec.guts ?? 0.6, 0.15, 1),
    },
    home: { x: spec.homeX ?? 0, z: spec.homeZ ?? 0 },
    x: spec.x ?? 0,
    z: spec.z ?? 0,
    vx: 0,
    vz: 0,
    facing: spec.facing ?? 0,
    speed: 0,
    stamina: 1,
    state: PSTATE.IDLE,
    stateT: 0,
    lock: 0,
    cooldown: 0,
    touchCooldown: 0,
    sprinting: false,
    fouls: 0,
    // 渲染层用的姿态提示（不参与判定）
    anim: { legPhase: 0, kickLeg: 1, lean: 0, armSwing: 0, blend: 0 },
    stats: { passes: 0, shots: 0, goals: 0, tackles: 0, distance: 0 },
  };
}

export function maxSpeedOf(player, weather) {
  const grip = weather?.gripFactor ?? 1;
  const fatigue = 0.62 + 0.38 * player.stamina;
  const base = PLAYER.baseSpeed * (0.82 + 0.36 * player.attr.pace);
  const sprint = player.sprinting ? PLAYER.sprintBonus * (0.6 + 0.4 * player.attr.pace) : 0;
  return (base + sprint) * fatigue * grip;
}

export function setState(player, state, lockOverride) {
  if (player.state === state && state !== PSTATE.SKILL) return;
  player.state = state;
  player.stateT = 0;
  player.lock = lockOverride ?? STATE_LOCK[state] ?? 0;
  // 渲染层用它把动作进度归一化到 0~1，动作曲线才不会被时长变化拉花
  player.lockTotal = player.lock || 0.001;
}

export function isBusy(player) {
  return player.lock > 0;
}

export function canAct(player) {
  return player.lock <= 0 && player.state !== PSTATE.FALL && player.state !== PSTATE.GETUP;
}

// desired: { dirX, dirZ, sprint } 归一化方向；返回本步实际位移
export function stepMotion(player, desired, dt, weather, format) {
  player.stateT += dt;
  player.lock = Math.max(0, player.lock - dt);
  player.cooldown = Math.max(0, player.cooldown - dt);
  player.touchCooldown = Math.max(0, player.touchCooldown - dt);

  const grounded = player.state !== PSTATE.FALL && player.state !== PSTATE.SLIDE && player.state !== PSTATE.DIVE;
  let dirX = desired?.dirX ?? 0;
  let dirZ = desired?.dirZ ?? 0;
  const inputLen = length2(dirX, dirZ);
  if (inputLen > 1) {
    dirX /= inputLen;
    dirZ /= inputLen;
  }

  player.sprinting = Boolean(desired?.sprint) && grounded && player.stamina > 0.08 && inputLen > 0.4;

  const max = maxSpeedOf(player, weather);
  let targetVx = dirX * max;
  let targetVz = dirZ * max;

  if (player.state === PSTATE.SLIDE) {
    // 铲球是惯性滑行，不能改方向
    const decay = Math.exp(-3.4 * dt);
    player.vx *= decay;
    player.vz *= decay;
    targetVx = player.vx;
    targetVz = player.vz;
  } else if (player.state === PSTATE.FALL || player.state === PSTATE.GETUP) {
    player.vx *= Math.exp(-9 * dt);
    player.vz *= Math.exp(-9 * dt);
    targetVx = player.vx;
    targetVz = player.vz;
  } else if (player.lock > 0 && (player.state === PSTATE.SHOOT || player.state === PSTATE.PASS || player.state === PSTATE.TACKLE)) {
    // 出脚时会明显减速——这是脚不打滑的关键
    targetVx *= 0.35;
    targetVz *= 0.35;
  }

  const accel = (inputLen > 0.05 ? PLAYER.accel : PLAYER.decel) * (0.7 + 0.3 * player.attr.pace) * (weather?.gripFactor ?? 1);
  player.vx = moveToward(player.vx, targetVx, accel * dt);
  player.vz = moveToward(player.vz, targetVz, accel * dt);

  const speed = length2(player.vx, player.vz);
  player.speed = speed;

  if (speed > 0.35 && player.state !== PSTATE.SLIDE && player.state !== PSTATE.DIVE) {
    const heading = Math.atan2(player.vx, player.vz);
    const turn = PLAYER.turnRate * (0.65 + 0.35 * player.attr.control) * dt;
    player.facing = turnToward(player.facing, heading, turn);
  }

  player.x += player.vx * dt;
  player.z += player.vz * dt;
  player.stats.distance += speed * dt;

  // 体力
  const drain = player.sprinting ? PLAYER.staminaDrain.sprint : speed > 1.2 ? PLAYER.staminaDrain.run : PLAYER.staminaDrain.idle;
  const recovery = 0.55 + 0.9 * player.attr.stamina;
  player.stamina = clamp(player.stamina - (drain / 100) * dt * (drain > 0 ? 2 - player.attr.stamina : recovery), 0, 1);

  // 出界钳制（球员可以跑出边线一点，但不能跑到看台上）
  const halfL = format.pitch.length / 2 + 3.2;
  const halfW = format.pitch.width / 2 + 3.2;
  player.x = clamp(player.x, -halfL, halfL);
  player.z = clamp(player.z, -halfW, halfW);

  // 动作相位：步频由速度反推，保证脚不打滑
  updateGaitPhase(player, dt);

  if (player.lock <= 0) {
    if (player.state === PSTATE.FALL) setState(player, PSTATE.GETUP);
    else if (player.state === PSTATE.GETUP || player.state === PSTATE.SLIDE || player.state === PSTATE.DIVE) setState(player, PSTATE.IDLE);
    else if (
      player.state !== PSTATE.IDLE &&
      player.state !== PSTATE.RUN &&
      player.state !== PSTATE.SPRINT &&
      player.state !== PSTATE.DRIBBLE
    ) {
      setState(player, PSTATE.IDLE);
    }
  }

  if (!isBusy(player)) {
    if (speed < 0.35) setState(player, PSTATE.IDLE);
    else if (player.sprinting) setState(player, PSTATE.SPRINT);
    else setState(player, PSTATE.RUN);
  }
  return speed;
}

// 步幅随速度变化：慢跑 1.35 m，冲刺 2.05 m。相位频率 = 速度 / 步幅。
export function strideLengthOf(player) {
  const base = 1.28 + 0.36 * player.attr.pace;
  return base + clamp(player.speed / 7.2, 0, 1) * 0.72;
}

function updateGaitPhase(player, dt) {
  const stride = strideLengthOf(player);
  const cycleDistance = stride * 2; // 一个完整循环包含左右各一步
  if (player.speed > 0.3) {
    player.anim.legPhase = (player.anim.legPhase + (player.speed / cycleDistance) * dt) % 1;
  } else {
    // 站立时缓慢回到中立姿势
    player.anim.legPhase = (player.anim.legPhase + 0.16 * dt) % 1;
  }
  player.anim.lean = clamp(player.speed / 8, 0, 1);
  player.anim.armSwing = clamp(player.speed / 6.5, 0, 1.2);
}

export function knockDown(player, dirX, dirZ, force = 1) {
  setState(player, PSTATE.FALL, 0.75 + 0.4 * force);
  player.vx = dirX * 2.6 * force;
  player.vz = dirZ * 2.6 * force;
  player.stamina = clamp(player.stamina - 0.05 * force, 0, 1);
}

export function faceTo(player, x, z) {
  player.facing = wrapAngle(Math.atan2(x - player.x, z - player.z));
}
