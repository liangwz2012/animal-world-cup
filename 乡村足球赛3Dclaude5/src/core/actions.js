// 触球动作：带球、短传、直塞、传中、射门、停球、头球、抢断、滑铲、门将扑救。
// 所有动作都只对球施加一次冲量，绝不把球黏在脚上。

import { BALL, PLAYER, PSTATE } from "./constants.js";
import { kickBall, solveKick } from "./ball.js";
import { clamp, dist2, length2, wrapAngle } from "./mathx.js";
import { faceTo, knockDown, maxSpeedOf, setState } from "./player.js";

export function attackDirOf(side) {
  return side === "home" ? 1 : -1;
}

export function goalCenterFor(match, side) {
  return { x: attackDirOf(side) * (match.format.pitch.length / 2), z: 0 };
}

export function ballDistance(player, ball) {
  return Math.sqrt((player.x - ball.x) ** 2 + (player.z - ball.z) ** 2);
}

export function pressureOn(match, player) {
  let nearest = 99;
  for (const other of match.players) {
    if (other.side === player.side) continue;
    const d = dist2(player, other);
    if (d < nearest) nearest = d;
  }
  return clamp(1 - nearest / 6, 0, 1);
}

// 误差模型：控球差、体力低、被逼抢、跑动中出脚 => 传丢/打偏。村超的可信度来自这里。
function accuracyOf(match, player, extra = 0) {
  const control = player.attr.control;
  const fatigue = 1 - player.stamina;
  const press = pressureOn(match, player);
  const motion = clamp(player.speed / maxSpeedOf(player, match.weather), 0, 1);
  const err = 0.055 + (1 - control) * 0.14 + fatigue * 0.1 + press * 0.09 + motion * 0.05 + extra;
  return clamp(err, 0.02, 0.42);
}

export function canTouchBall(player, ball) {
  if (player.touchCooldown > 0) return false;
  const flat = ballDistance(player, ball);
  if (flat > PLAYER.reachRadius) return false;
  return ball.y < 1.05;
}

// 带球：把球轻推到身前，速度越快推得越远（真实的"大力带球"）
export function dribbleTouch(match, player) {
  const ball = match.ball;
  const push = 1.05 + clamp(player.speed / 6, 0, 1) * 1.5;
  const control = 0.6 + 0.4 * player.attr.control;
  const dirX = Math.sin(player.facing);
  const dirZ = Math.cos(player.facing);
  const wobble = match.prng.signed(0.24 * (1 - control));
  const speed = clamp(player.speed * (0.95 + 0.3 * control) + 0.7, 1.4, 9);
  kickBall(ball, {
    vx: (dirX + wobble * 0.35) * speed,
    vz: (dirZ - wobble * 0.35) * speed,
    vy: 0,
    spin: wobble * 0.6,
    playerId: player.id,
    side: player.side,
    time: match.time,
  });
  ball.x = player.x + dirX * 0.42;
  ball.z = player.z + dirZ * 0.42;
  player.touchCooldown = clamp(push / Math.max(2, speed), 0.16, 0.55);
  match.possession = { id: player.id, side: player.side, since: match.time };
  return true;
}

export function trapBall(match, player) {
  const ball = match.ball;
  const quality = 0.35 + 0.55 * player.attr.control;
  ball.vx *= 1 - quality;
  ball.vz *= 1 - quality;
  ball.vy *= 0.25;
  setState(player, PSTATE.TRAP);
  player.touchCooldown = 0.18;
  ball.lastTouchId = player.id;
  ball.lastTouchSide = player.side;
  match.possession = { id: player.id, side: player.side, since: match.time };
}

export function pickPassTarget(match, player, { forward = false, longRange = false } = {}) {
  const dir = attackDirOf(player.side);
  let best = null;
  let bestScore = -Infinity;
  for (const mate of match.players) {
    if (mate.side !== player.side || mate.id === player.id) continue;
    if (mate.state === PSTATE.FALL) continue;
    const d = dist2(player, mate);
    if (d < 2.2 || d > (longRange ? 46 : 26)) continue;
    const toX = mate.x - player.x;
    const toZ = mate.z - player.z;
    const facingDot = (Math.sin(player.facing) * toX + Math.cos(player.facing) * toZ) / Math.max(0.001, d);
    const advance = (mate.x - player.x) * dir;
    const laneRisk = passLaneRisk(match, player, mate);
    let score = facingDot * 2.2 + advance * 0.16 - laneRisk * 3.4 - d * 0.03;
    if (forward) score += advance * 0.3 + (mate.role === "A" ? 1.2 : 0);
    if (mate.role === "G") score -= 3;
    if (score > bestScore) {
      bestScore = score;
      best = mate;
    }
  }
  return best;
}

function passLaneRisk(match, from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = length2(dx, dz);
  if (len < 0.5) return 0;
  const nx = dx / len;
  const nz = dz / len;
  let risk = 0;
  for (const opp of match.players) {
    if (opp.side === from.side) continue;
    const rx = opp.x - from.x;
    const rz = opp.z - from.z;
    const along = rx * nx + rz * nz;
    if (along < 0.5 || along > len) continue;
    const lateral = Math.abs(rx * nz - rz * nx);
    risk += clamp(1 - lateral / 2.4, 0, 1) * clamp(1 - along / len, 0.25, 1);
  }
  return risk;
}

export function doPass(match, player, { style = "ground", target = null, power = 1 } = {}) {
  const ball = match.ball;
  const mate = target || pickPassTarget(match, player, { forward: style !== "ground", longRange: style === "cross" });
  const err = accuracyOf(match, player, style === "ground" ? 0 : 0.03);
  let aim;
  if (mate) {
    // 提前量：传给跑动中的队友的前方
    const lead = style === "through" ? 3.6 : 1.4;
    aim = { x: mate.x + mate.vx * lead * 0.28, z: mate.z + mate.vz * lead * 0.28 };
    if (style === "through") {
      const dir = attackDirOf(player.side);
      aim.x += dir * 4.2;
    }
  } else {
    const dir = attackDirOf(player.side);
    aim = { x: player.x + dir * 12, z: player.z + match.prng.signed(6) };
  }
  aim.x += match.prng.signed(err * 9);
  aim.z += match.prng.signed(err * 9);

  const kickStyle = style === "cross" ? "cross" : style === "through" ? "ground" : "ground";
  const solved = solveKick(player, aim, kickStyle, power * (0.75 + 0.35 * player.attr.power));
  faceTo(player, aim.x, aim.z);
  setState(player, PSTATE.PASS);
  player.anim.kickLeg = match.prng.chance(0.5) ? 1 : -1;
  player.touchCooldown = 0.3;
  player.stats.passes += 1;
  kickBall(ball, {
    vx: solved.vx,
    vy: solved.vy,
    vz: solved.vz,
    spin: match.prng.signed(0.5) * (style === "cross" ? 1.6 : 0.5),
    playerId: player.id,
    side: player.side,
    time: match.time,
  });
  match.possession = { id: -1, side: player.side, since: match.time };
  match.pushEvent({ type: "pass", side: player.side, playerId: player.id, style, targetId: mate ? mate.id : -1 });
  return mate;
}

export function doShot(match, player, power = 1) {
  const ball = match.ball;
  const goal = goalCenterFor(match, player.side);
  const dist = Math.sqrt((goal.x - player.x) ** 2 + (goal.z - player.z) ** 2);
  const err = accuracyOf(match, player, 0.03 + clamp(dist / 90, 0, 0.12));
  const halfGoal = match.format.goal.width / 2;
  // 有意瞄向门柱内侧，误差再把球带偏——远射经常高出横梁
  const aimZ = clamp(match.prng.signed(halfGoal * 0.8) + match.prng.signed(err * 12), -halfGoal * 1.9, halfGoal * 1.9);
  const target = { x: goal.x + attackDirOf(player.side) * 0.6, z: aimZ };
  const charge = clamp(power, 0.35, 1);
  const strength = 0.72 + 0.5 * player.attr.power;
  const solved = solveKick(player, target, "drive", charge * strength * 1.32);
  const lift = clamp(0.35 + charge * 1.5 + match.prng.signed(err * 9), 0.1, 4.6);
  faceTo(player, target.x, target.z);
  setState(player, PSTATE.SHOOT);
  player.anim.kickLeg = match.prng.chance(0.62) ? 1 : -1;
  player.touchCooldown = 0.42;
  player.stats.shots += 1;
  kickBall(ball, {
    vx: solved.vx,
    vy: lift,
    vz: solved.vz,
    spin: match.prng.signed(1.5) * (0.5 + 0.5 * player.attr.control),
    playerId: player.id,
    side: player.side,
    time: match.time,
  });
  match.possession = { id: -1, side: player.side, since: match.time };
  match.pushEvent({ type: "shot", side: player.side, playerId: player.id, power: charge });
}

export function doHeader(match, player) {
  const ball = match.ball;
  const goal = goalCenterFor(match, player.side);
  const toGoal = Math.sqrt((goal.x - player.x) ** 2 + (goal.z - player.z) ** 2);
  const attacking = toGoal < 22;
  const target = attacking
    ? { x: goal.x, z: clamp(match.prng.signed(match.format.goal.width * 0.5), -3, 3) }
    : { x: player.x + attackDirOf(player.side) * 16, z: player.z + match.prng.signed(8) };
  const solved = solveKick(player, target, attacking ? "drive" : "cross", 0.72 + 0.4 * player.attr.power);
  setState(player, PSTATE.HEADER);
  player.touchCooldown = 0.5;
  kickBall(ball, {
    vx: solved.vx * 0.78,
    vy: attacking ? -0.4 : solved.vy,
    vz: solved.vz * 0.78,
    spin: match.prng.signed(0.6),
    playerId: player.id,
    side: player.side,
    time: match.time,
  });
  match.pushEvent({ type: "header", side: player.side, playerId: player.id });
}

// 抢断/滑铲：判定同时产生犯规。背后铲、铲空、铲到人先于球 => 犯规。
export function doTackle(match, player, slide = false) {
  setState(player, slide ? PSTATE.SLIDE : PSTATE.TACKLE);
  player.tackleResolved = false;
  player.tackleWonBall = false;
  if (slide) {
    const dirX = Math.sin(player.facing);
    const dirZ = Math.cos(player.facing);
    const boost = 4.6 + 2.4 * player.attr.power;
    player.vx = dirX * boost;
    player.vz = dirZ * boost;
  }
  player.stats.tackles += 1;
  match.pushEvent({ type: slide ? "slide" : "tackle", side: player.side, playerId: player.id });
}

export function resolveTackleContact(match, player) {
  const ball = match.ball;
  const reach = player.state === PSTATE.SLIDE ? PLAYER.tackleRadius + 0.6 : PLAYER.tackleRadius;
  const carrier = match.players.find((p) => p.id === match.possession.id);
  const gotBall = ballDistance(player, ball) < reach && ball.y < 1.1;

  if (gotBall) {
    player.tackleWonBall = true;
    const dirX = Math.sin(player.facing);
    const dirZ = Math.cos(player.facing);
    const power = player.state === PSTATE.SLIDE ? 7.2 : 4.4;
    kickBall(ball, {
      vx: dirX * power + match.prng.signed(1.6),
      vz: dirZ * power + match.prng.signed(1.6),
      vy: player.state === PSTATE.SLIDE ? 0.9 : 0.2,
      spin: match.prng.signed(0.8),
      playerId: player.id,
      side: player.side,
      time: match.time,
    });
    match.possession = { id: -1, side: player.side, since: match.time };
    player.touchCooldown = 0.35;
  }

  if (!carrier || carrier.side === player.side) return gotBall;
  // 一次抢断动作最多判定一次身体接触，避免同一次滑铲连判多次犯规
  if (player.tackleResolved) return gotBall;
  const contact = dist2(player, carrier);
  if (contact > reach + 0.35) return gotBall;
  player.tackleResolved = true;

  const fromBehind = Math.cos(wrapAngle(player.facing - carrier.facing)) > 0.35;
  // 先碰到球再撞到人 = 干净断球；铲空却撞倒人 = 犯规；背后铲有较高判罚概率
  const cleanFirst = gotBall || player.tackleWonBall;
  const foul = cleanFirst
    ? player.state === PSTATE.SLIDE && fromBehind && match.prng.chance(0.28)
    : match.prng.chance(0.72);
  const dirX = (carrier.x - player.x) / Math.max(0.2, contact);
  const dirZ = (carrier.z - player.z) / Math.max(0.2, contact);
  knockDown(carrier, dirX, dirZ, foul ? 1.15 : 0.7);
  if (foul) {
    player.fouls += 1;
    match.onFoul(player, carrier);
  }
  return gotBall;
}

// 门将扑救：只在球飞向球门时触发，扑救成功率由反应、角度、球速决定
export function goalkeeperDive(match, keeper, predicted) {
  const dirZ = Math.sign(predicted.z - keeper.z) || 1;
  setState(keeper, PSTATE.DIVE);
  keeper.anim.kickLeg = dirZ;
  keeper.vz = dirZ * (4.5 + 2.5 * keeper.attr.guts);
  keeper.vx = 0;
  match.pushEvent({ type: "save-attempt", side: keeper.side, playerId: keeper.id });
}

export function goalkeeperCatch(match, keeper) {
  // 已经抱住球或刚出手，不能再次判定扑救（否则倒地扑救会逐帧刷"救球"）
  if (match.keeperHold > 0 || keeper.touchCooldown > 0) return;
  const ball = match.ball;
  const dir = -attackDirOf(keeper.side);
  kickBall(ball, { vx: 0, vy: 0, vz: 0, playerId: keeper.id, side: keeper.side, time: match.time });
  ball.x = keeper.x + dir * 0.3;
  ball.z = keeper.z;
  ball.y = 0.9;
  keeper.touchCooldown = 0.7;
  match.possession = { id: keeper.id, side: keeper.side, since: match.time };
  match.pushEvent({ type: "save", side: keeper.side, playerId: keeper.id });
  match.keeperHold = 1.2;
}

export function goalkeeperThrow(match, keeper) {
  const mate = pickPassTarget(match, keeper, { forward: true, longRange: true });
  const dir = attackDirOf(keeper.side);
  const aim = mate ? { x: mate.x, z: mate.z } : { x: keeper.x + dir * 20, z: keeper.z };
  const solved = solveKick(keeper, aim, "cross", 0.9);
  setState(keeper, PSTATE.THROW);
  // 抛球出手后有一段不可再触球时间，否则门将会把刚抛出的球立刻再"扑"回来
  keeper.touchCooldown = 1.1;
  kickBall(match.ball, {
    vx: solved.vx,
    vy: solved.vy * 0.8,
    vz: solved.vz,
    playerId: keeper.id,
    side: keeper.side,
    time: match.time,
  });
  match.possession = { id: -1, side: keeper.side, since: match.time };
  match.keeperHold = 0;
}

// 技巧动作：急停变向 / 踩单车 / 拨球过人。乡土命名在内容层做。
export function doSkill(match, player, kind = "cut") {
  setState(player, PSTATE.SKILL);
  player.anim.skill = kind;
  const ball = match.ball;
  const quality = 0.4 + 0.6 * player.attr.control;
  if (kind === "cut") {
    const side = match.prng.chance(0.5) ? 1 : -1;
    player.facing = wrapAngle(player.facing + side * 1.15);
    const dirX = Math.sin(player.facing);
    const dirZ = Math.cos(player.facing);
    kickBall(ball, {
      vx: dirX * 4.4 * quality,
      vz: dirZ * 4.4 * quality,
      vy: 0,
      playerId: player.id,
      side: player.side,
      time: match.time,
    });
    player.vx *= 0.35;
    player.vz *= 0.35;
  } else if (kind === "stepover") {
    const dirX = Math.sin(player.facing);
    const dirZ = Math.cos(player.facing);
    kickBall(ball, {
      vx: dirX * 6.6 * quality,
      vz: dirZ * 6.6 * quality,
      vy: 0,
      playerId: player.id,
      side: player.side,
      time: match.time,
    });
  } else if (kind === "flick") {
    const dirX = Math.sin(player.facing);
    const dirZ = Math.cos(player.facing);
    kickBall(ball, {
      vx: dirX * 5,
      vz: dirZ * 5,
      vy: 3.4 * quality,
      spin: match.prng.signed(0.8),
      playerId: player.id,
      side: player.side,
      time: match.time,
    });
  }
  player.touchCooldown = 0.34;
  match.pushEvent({ type: "skill", side: player.side, playerId: player.id, kind });
}

export const BALL_RADIUS = BALL.radius;
