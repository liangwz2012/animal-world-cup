// 村队 AI：位置感 + 逼抢 + 接应跑位 + 门将。
// 难度不是靠改速度上限作弊，而是改反应延迟、决策噪声和逼抢积极性。

import { MATCH_PHASE, PLAYER, PSTATE } from "./constants.js";
import { predictBall } from "./ball.js";
import { clamp, dist2, length2 } from "./mathx.js";
import {
  attackDirOf,
  ballDistance,
  canTouchBall,
  doHeader,
  doPass,
  doShot,
  doSkill,
  doTackle,
  dribbleTouch,
  goalCenterFor,
  goalkeeperCatch,
  goalkeeperDive,
  goalkeeperThrow,
  pickPassTarget,
  pressureOn,
  trapBall,
} from "./actions.js";
import { canAct, faceTo } from "./player.js";

export const DIFFICULTY = Object.freeze({
  easy: { react: 0.34, noise: 0.32, press: 0.55, shootBias: 0.7, label: "乡邻友谊赛" },
  normal: { react: 0.2, noise: 0.18, press: 0.78, shootBias: 0.9, label: "村寨联赛" },
  hard: { react: 0.11, noise: 0.09, press: 0.95, shootBias: 1.05, label: "村超争霸" },
});

// 阵型：按角色给出归一化站位（x 为进攻方向 -1..1，z 为横向 -1..1）
const FORMATION_SLOTS = Object.freeze({
  5: [
    { role: "G", x: -0.93, z: 0 },
    { role: "D", x: -0.52, z: -0.36 },
    { role: "D", x: -0.52, z: 0.36 },
    { role: "M", x: -0.1, z: 0 },
    { role: "A", x: 0.34, z: 0 },
  ],
  7: [
    { role: "G", x: -0.93, z: 0 },
    { role: "D", x: -0.6, z: -0.44 },
    { role: "D", x: -0.64, z: 0 },
    { role: "D", x: -0.6, z: 0.44 },
    { role: "M", x: -0.16, z: -0.3 },
    { role: "M", x: -0.16, z: 0.3 },
    { role: "A", x: 0.36, z: 0 },
  ],
});

export function formationFor(perSide) {
  return FORMATION_SLOTS[perSide] || FORMATION_SLOTS[5];
}

export function homePositionFor(match, player) {
  const slots = formationFor(match.format.perSide);
  const slot = slots[player.index] || slots[slots.length - 1];
  const dir = attackDirOf(player.side);
  const halfL = match.format.pitch.length / 2;
  const halfW = match.format.pitch.width / 2;
  // 全队随球前后移动：控球时整体压上，丢球时回收
  const ballShift = clamp(match.ball.x / halfL, -1, 1) * 0.3;
  const zShift = clamp(match.ball.z / halfW, -1, 1) * 0.28;
  const x = (slot.x + ballShift * dir) * halfL * dir;
  const z = (slot.z + zShift) * halfW;
  return { x: clamp(x, -halfL + 1, halfL - 1), z: clamp(z, -halfW + 1.4, halfW - 1.4) };
}

function nearestOwn(match, side, x, z, filter) {
  let best = null;
  let bestD = Infinity;
  for (const p of match.players) {
    if (p.side !== side) continue;
    if (filter && !filter(p)) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export function updateAi(match, player, dt, difficulty) {
  const conf = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  player.aiTimer = (player.aiTimer ?? 0) - dt;
  if (player.aiTimer <= 0) {
    player.aiTimer = conf.react * (0.7 + match.prng.next() * 0.6);
    player.aiPlan = decide(match, player, conf);
  }
  return player.aiPlan || { dirX: 0, dirZ: 0, sprint: false };
}

function decide(match, player, conf) {
  if (player.role === "G") return decideKeeper(match, player, conf);
  if (match.phase !== MATCH_PHASE.PLAY) return decideSetPiece(match, player, conf);

  const ball = match.ball;
  const carrier = match.players.find((p) => p.id === match.possession.id);
  const hasBall = carrier && carrier.id === player.id;
  const teamHasBall = carrier && carrier.side === player.side;

  if (hasBall && canAct(player)) return decideOnBall(match, player, conf);

  // 无球：最近的人去抢球，其他人跑位
  const chaser = nearestOwn(match, player.side, ball.x, ball.z, (p) => p.role !== "G" && p.state !== PSTATE.FALL);
  const isChaser = chaser && chaser.id === player.id;

  if (!teamHasBall && isChaser) {
    const lead = predictBall(ball, 0.35, match.weather);
    const plan = moveTo(match, player, lead.x, lead.z, true);
    const gap = ballDistance(player, ball);
    if (carrier && carrier.side !== player.side && dist2(player, carrier) < PLAYER.tackleRadius + 0.5 && canAct(player)) {
      // 抢断不是每帧都上：村队后卫更愿意先卡住路线，铲球是最后手段
      if (match.prng.chance(conf.press * 0.16)) doTackle(match, player, match.prng.chance(0.18));
    } else if (gap < PLAYER.reachRadius && canAct(player)) {
      if (ball.y > PLAYER.headerHeight.min && ball.y < PLAYER.headerHeight.max) doHeader(match, player);
      else if (length2(ball.vx, ball.vz) > 6) trapBall(match, player);
      else dribbleTouch(match, player);
    }
    return plan;
  }

  if (teamHasBall) return decideSupport(match, player, conf, carrier);
  return decideDefend(match, player, conf, carrier);
}

function decideOnBall(match, player, conf) {
  const goal = goalCenterFor(match, player.side);
  const dir = attackDirOf(player.side);
  const toGoal = Math.hypot(goal.x - player.x, goal.z - player.z);
  const press = pressureOn(match, player);
  const noise = match.prng.signed(conf.noise);

  // 射门：进入合理射程且角度不太刁钻
  const shootRange = 17 + player.attr.power * 7;
  const angleOk = Math.abs(player.z) < match.format.pitch.width * 0.34;
  if (toGoal < shootRange && angleOk && match.prng.chance(clamp((1 - toGoal / shootRange) * conf.shootBias + noise, 0.05, 0.95))) {
    doShot(match, player, clamp(0.55 + toGoal / 30, 0.45, 1));
    return { dirX: 0, dirZ: 0, sprint: false };
  }

  // 被逼死了就出球
  if (press > 0.62 || match.prng.chance(0.24 + press * 0.4)) {
    const mate = pickPassTarget(match, player, { forward: press < 0.5 });
    if (mate) {
      const far = dist2(player, mate) > 24;
      doPass(match, player, { style: far ? "cross" : press > 0.7 ? "ground" : "through", target: mate, power: 1 });
      return { dirX: 0, dirZ: 0, sprint: false };
    }
  }

  // 过人：面前有人且自己控球不错
  if (press > 0.45 && player.attr.control > 0.55 && match.prng.chance(0.18)) {
    doSkill(match, player, match.prng.chance(0.5) ? "cut" : "stepover");
    return { dirX: 0, dirZ: 0, sprint: false };
  }

  // 带球推进
  const targetX = goal.x;
  const targetZ = clamp(player.z * 0.7 + match.prng.signed(4), -match.format.pitch.width * 0.42, match.format.pitch.width * 0.42);
  const plan = moveTo(match, player, targetX - dir * 4, targetZ, press < 0.4);
  if (canTouchBall(player, match.ball) && canAct(player)) dribbleTouch(match, player);
  return plan;
}

function decideSupport(match, player, conf, carrier) {
  const dir = attackDirOf(player.side);
  const home = homePositionFor(match, player);
  const halfW = match.format.pitch.width / 2;
  let targetX = home.x;
  let targetZ = home.z;
  if (player.role === "A" || player.role === "M") {
    // 前插接应：跑到持球人斜前方，拉开横向距离
    const spread = player.z >= 0 ? 1 : -1;
    targetX = carrier.x + dir * (player.role === "A" ? 9 : 4.5);
    targetZ = clamp(carrier.z + spread * (5 + match.prng.next() * 4), -halfW + 2, halfW - 2);
  }
  targetX = clamp(targetX, -match.format.pitch.length / 2 + 2, match.format.pitch.length / 2 - 2);
  const runHard = player.role !== "D" && Math.abs(carrier.x - player.x) < 16;
  const plan = moveTo(match, player, targetX, targetZ, runHard && player.stamina > 0.35);
  maybeReceive(match, player);
  return plan;
}

function decideDefend(match, player, conf, carrier) {
  const home = homePositionFor(match, player);
  // 盯人：后卫盯最靠近本方球门的对方前场球员
  let markTarget = null;
  if (player.role === "D" || player.role === "M") {
    const dir = attackDirOf(player.side);
    let bestScore = -Infinity;
    for (const opp of match.players) {
      if (opp.side === player.side || opp.role === "G") continue;
      const threat = -opp.x * dir + (carrier && carrier.id === opp.id ? 6 : 0) - dist2(player, opp) * 0.35;
      if (threat > bestScore) {
        bestScore = threat;
        markTarget = opp;
      }
    }
  }
  let targetX = home.x;
  let targetZ = home.z;
  if (markTarget) {
    const dir = attackDirOf(player.side);
    targetX = markTarget.x - dir * 1.8;
    targetZ = markTarget.z * 0.85 + home.z * 0.15;
  }
  const plan = moveTo(match, player, targetX, targetZ, conf.press > 0.8 && match.prng.chance(0.4));
  maybeReceive(match, player);
  return plan;
}

function maybeReceive(match, player) {
  const ball = match.ball;
  if (!canAct(player)) return;
  if (ballDistance(player, ball) > PLAYER.reachRadius) return;
  if (ball.lastTouchId === player.id && player.touchCooldown > 0) return;
  if (ball.y > PLAYER.headerHeight.min && ball.y < PLAYER.headerHeight.max) {
    doHeader(match, player);
  } else if (ball.y < 1.05) {
    if (length2(ball.vx, ball.vz) > 5.5) trapBall(match, player);
    else dribbleTouch(match, player);
  }
}

function decideKeeper(match, keeper, conf) {
  const ball = match.ball;
  const dir = attackDirOf(keeper.side);
  const lineX = -dir * (match.format.pitch.length / 2 - 1.1);
  const halfGoal = match.format.goal.width / 2;

  // 抱住球的时候原地站住，开球时机由比赛核心统一控制
  if (match.keeperHold > 0) return { dirX: 0, dirZ: 0, sprint: false };

  const gap = ballDistance(keeper, ball);

  if (gap < PLAYER.reachRadius + 0.35 && ball.y < 2.1 && canAct(keeper) && keeper.touchCooldown <= 0) {
    goalkeeperCatch(match, keeper);
    return { dirX: 0, dirZ: 0, sprint: false };
  }

  // 只有"真的射向本方球门"才扑：算出球到门线的时间，再看那一刻它落在哪。
  // 之前只判断球在往这边滚，结果门将在中场就开始满地打滚。
  const closingSpeed = -ball.vx * dir;
  if (closingSpeed > 5 && canAct(keeper)) {
    const flightTime = Math.abs(lineX - ball.x) / closingSpeed;
    if (flightTime < 1.05) {
      const pred = predictBall(ball, flightTime, match.weather);
      const onTarget = Math.abs(pred.z) < halfGoal + 1.1 && pred.y < match.format.goal.height + 0.5;
      const lateral = Math.abs(pred.z - keeper.z);
      if (onTarget && lateral > 0.75 && lateral < 5 && match.prng.chance(0.55 + conf.press * 0.4)) {
        goalkeeperDive(match, keeper, pred);
        return { dirX: 0, dirZ: 0, sprint: false };
      }
    }
  }

  // 出击：对方单刀且球离球门近
  const ballTowardUs = (ball.x - lineX) * dir < 0 ? false : Math.abs(ball.x - lineX) < 13;
  const carrier = match.players.find((p) => p.id === match.possession.id);
  const oneOnOne = carrier && carrier.side !== keeper.side && Math.abs(carrier.x - lineX) < 11;
  if (ballTowardUs && oneOnOne && match.prng.chance(conf.press * 0.5)) {
    return moveTo(match, keeper, ball.x, ball.z, true);
  }

  // 站位：在球与球门连线上，贴近门线
  const t = clamp(1 - Math.abs(ball.x - lineX) / 26, 0.06, 0.42);
  const standX = lineX + dir * t * 6;
  const standZ = clamp(ball.z * 0.55, -halfGoal - 0.6, halfGoal + 0.6);
  faceTo(keeper, ball.x, ball.z);
  return moveTo(match, keeper, standX, standZ, Math.abs(standZ - keeper.z) > 3.5);
}

function decideSetPiece(match, player, conf) {
  const spot = match.setPiece;
  if (!spot) return { dirX: 0, dirZ: 0, sprint: false };
  if (spot.takerId === player.id) {
    return moveTo(match, player, spot.x - Math.sin(player.facing) * 1.1, spot.z - Math.cos(player.facing) * 1.1, false);
  }
  const home = homePositionFor(match, player);
  // 与死球点保持规定距离
  const d = Math.hypot(home.x - spot.x, home.z - spot.z);
  let tx = home.x;
  let tz = home.z;
  if (spot.side !== player.side && d < 6.5) {
    const nx = (home.x - spot.x) / Math.max(0.1, d);
    const nz = (home.z - spot.z) / Math.max(0.1, d);
    tx = spot.x + nx * 6.8;
    tz = spot.z + nz * 6.8;
  }
  return moveTo(match, player, tx, tz, false);
}

export function moveTo(match, player, x, z, sprint) {
  const dx = x - player.x;
  const dz = z - player.z;
  const d = length2(dx, dz);
  if (d < 0.35) return { dirX: 0, dirZ: 0, sprint: false };
  const scale = clamp(d / 1.4, 0, 1);
  return { dirX: (dx / d) * scale, dirZ: (dz / d) * scale, sprint: Boolean(sprint) && d > 3.5 };
}
