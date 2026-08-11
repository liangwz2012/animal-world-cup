// 30 Hz 确定性比赛核心。渲染、UI、音效全部只读这里的状态。
// 规则覆盖：开球、界外球、球门球、角球、任意球、点球、越位（可关）、犯规、半场、终场。

import { BALL, FORMATS, MATCH_PHASE, PLAYER, PSTATE, TICK_DT, WEATHER } from "./constants.js";
import { createBall, resetBall, stepBall } from "./ball.js";
import { createPrng } from "./prng.js";
import { clamp, dist2, length2 } from "./mathx.js";
import { createPlayer, canAct, faceTo, knockDown, setState, stepMotion } from "./player.js";
import { DIFFICULTY, formationFor, homePositionFor, moveTo, updateAi } from "./ai.js";
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
  goalkeeperThrow,
  pickPassTarget,
  resolveTackleContact,
  trapBall,
} from "./actions.js";

const EMPTY_INPUT = Object.freeze({ moveX: 0, moveZ: 0, sprint: false, shootPower: 0, actions: Object.freeze({}) });

export function createMatch(options = {}) {
  const format = FORMATS[options.formatId] || FORMATS["5v5"];
  const weather = WEATHER[options.weatherId] || WEATHER.clear;
  const prng = createPrng(options.seed ?? 20260804);

  const match = {
    format,
    weather,
    prng,
    difficulty: options.difficulty || "normal",
    controlledSide: options.controlledSide || "home",
    autoSwitch: options.autoSwitch !== false,
    // 观战/演示模式：双方都交给 AI，不保留玩家操控位
    autoPlay: options.autoPlay === true,
    teams: {
      home: options.home || fallbackTeam("home"),
      away: options.away || fallbackTeam("away"),
    },
    ball: createBall(),
    players: [],
    time: 0,
    half: 1,
    halfSeconds: options.halfSeconds ?? format.halfSeconds,
    phase: MATCH_PHASE.KICKOFF,
    phaseTimer: 1.6,
    score: { home: 0, away: 0 },
    shots: { home: 0, away: 0 },
    fouls: { home: 0, away: 0 },
    possessionTicks: { home: 0, away: 0 },
    possession: { id: -1, side: "", since: 0 },
    setPiece: null,
    keeperHold: 0,
    controlledId: -1,
    events: [],
    tick: 0,
    lastGoal: null,
    finished: false,
    pushEvent(event) {
      match.events.push({ ...event, time: match.time, tick: match.tick });
      if (match.events.length > 96) match.events.splice(0, match.events.length - 96);
    },
    onFoul(offender, victim) {
      match.fouls[offender.side] += 1;
      const dir = attackDirOf(offender.side);
      const halfL = format.pitch.length / 2;
      const inBox = (victim.x * -dir) > halfL - format.penaltyDepth && Math.abs(victim.z) < format.penaltyWidth / 2;
      const penalty = inBox && victim.side !== offender.side;
      match.pushEvent({ type: "foul", side: offender.side, playerId: offender.id, victimId: victim.id, penalty });
      startSetPiece(match, penalty ? MATCH_PHASE.PENALTY : MATCH_PHASE.FREE_KICK, {
        side: victim.side,
        x: penalty ? attackDirOf(victim.side) * (halfL - format.penaltyDepth * 0.62) : victim.x,
        z: penalty ? 0 : victim.z,
      });
    },
  };

  buildSquads(match);
  resetForKickoff(match, "home");
  return match;
}

function fallbackTeam(side) {
  return {
    id: side,
    name: side === "home" ? "本村队" : "客村队",
    shortName: side === "home" ? "本村" : "客村",
    players: [],
  };
}

function buildSquads(match) {
  const slots = formationFor(match.format.perSide);
  let id = 0;
  for (const side of ["home", "away"]) {
    const team = match.teams[side];
    const roster = Array.isArray(team.players) ? team.players : [];
    for (let i = 0; i < match.format.perSide; i += 1) {
      const slot = slots[i];
      const src = roster[i] || {};
      match.players.push(
        createPlayer({
          id: id++,
          side,
          index: i,
          role: slot.role,
          number: src.number ?? i + 1,
          name: src.name ?? `${side === "home" ? "主" : "客"}${i + 1}`,
          pace: src.pace,
          power: src.power,
          control: src.control,
          stamina: src.stamina,
          guts: src.guts,
        }),
      );
    }
  }
}

export function resetForKickoff(match, kickingSide) {
  const { format } = match;
  resetBall(match.ball, 0, 0);
  match.setPiece = null;
  match.keeperHold = 0;
  match.possession = { id: -1, side: kickingSide, since: match.time };
  for (const player of match.players) {
    const home = homePositionFor(match, player);
    const dir = attackDirOf(player.side);
    // 开球时全队必须在本方半场
    const x = player.side === kickingSide && player.index === format.perSide - 1 ? -dir * 1.2 : Math.min(home.x * dir, -1.5) * dir;
    player.x = x;
    player.z = home.z;
    player.vx = 0;
    player.vz = 0;
    player.facing = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    player.speed = 0;
    setState(player, PSTATE.IDLE, 0);
  }
  match.phase = MATCH_PHASE.KICKOFF;
  match.phaseTimer = 1.4;
  match.kickoffSide = kickingSide;
  const taker = match.players.find((p) => p.side === kickingSide && p.index === format.perSide - 1);
  if (taker) {
    taker.x = -attackDirOf(kickingSide) * 0.9;
    taker.z = 0.6;
    if (!match.autoPlay) match.controlledId = match.controlledSide === kickingSide ? taker.id : match.controlledId;
  }
  if (match.autoPlay) {
    match.controlledId = -1;
  } else if (match.controlledId < 0) {
    const first = match.players.find((p) => p.side === match.controlledSide && p.role !== "G");
    match.controlledId = first ? first.id : -1;
  }
}

function startSetPiece(match, phase, { side, x, z, takerId } = {}) {
  const halfL = match.format.pitch.length / 2;
  const halfW = match.format.pitch.width / 2;
  const spotX = clamp(x ?? 0, -halfL + 0.6, halfL - 0.6);
  const spotZ = clamp(z ?? 0, -halfW + 0.6, halfW - 0.6);
  resetBall(match.ball, spotX, spotZ);
  match.phase = phase;
  match.phaseTimer = phase === MATCH_PHASE.PENALTY ? 2.2 : 1.5;
  match.keeperHold = 0;
  let taker = takerId != null ? match.players.find((p) => p.id === takerId) : null;
  if (!taker) {
    const candidates = match.players.filter((p) => p.side === side && (phase !== MATCH_PHASE.GOAL_KICK ? p.role !== "G" : p.role === "G"));
    taker = candidates.reduce((best, p) => {
      const d = Math.hypot(p.x - spotX, p.z - spotZ);
      return !best || d < best.d ? { p, d } : best;
    }, null)?.p;
  }
  match.setPiece = { phase, side, x: spotX, z: spotZ, takerId: taker ? taker.id : -1 };
  if (taker) {
    taker.x = spotX - Math.sign(spotX || 1) * 0.1;
    taker.z = spotZ;
    faceTo(taker, attackDirOf(side) * halfL, 0);
    setState(taker, PSTATE.IDLE, 0);
    if (side === match.controlledSide) match.controlledId = taker.id;
  }
  match.pushEvent({ type: "set-piece", phase, side });
}

export function stepMatch(match, rawInput = EMPTY_INPUT) {
  if (match.finished) return match;
  const dt = TICK_DT;
  match.tick += 1;
  match.events.length = 0;

  const input = normalizeInput(rawInput);

  if (match.phase === MATCH_PHASE.PLAY) {
    match.time += dt;
    if (match.possession.side) match.possessionTicks[match.possession.side] += 1;
  } else {
    match.phaseTimer -= dt;
  }
  // 门将抱球：球跟着门将走，倒计时结束由核心统一发球，避免 AI 决策节奏错过而反复"扑救"
  if (match.keeperHold > 0) {
    const holder = match.players.find((p) => p.id === match.possession.id && p.role === "G");
    if (holder) {
      match.ball.x = holder.x + attackDirOf(holder.side) * 0.28;
      match.ball.z = holder.z;
      match.ball.y = 0.95;
      match.ball.vx = 0;
      match.ball.vy = 0;
      match.ball.vz = 0;
    }
    match.keeperHold = Math.max(0, match.keeperHold - dt);
    if (match.keeperHold === 0 && holder) goalkeeperThrow(match, holder);
  }

  handlePhaseTransitions(match, input);

  // 决策与运动
  for (const player of match.players) {
    let desired;
    if (player.id === match.controlledId && player.side === match.controlledSide && match.phase !== MATCH_PHASE.GOAL) {
      desired = applyHumanInput(match, player, input);
    } else {
      desired = updateAi(match, player, dt, match.difficulty);
    }
    if (match.phase === MATCH_PHASE.GOAL) {
      desired = celebrateMotion(match, player);
    }
    stepMotion(player, desired, dt, match.weather, match.format);
  }

  resolveBodies(match);

  for (const player of match.players) {
    if (player.state === PSTATE.TACKLE || player.state === PSTATE.SLIDE) resolveTackleContact(match, player);
    if (player.state === PSTATE.DIVE) resolveDive(match, player);
  }

  if (match.phase === MATCH_PHASE.PLAY || match.phase === MATCH_PHASE.GOAL) {
    stepBall(match.ball, dt, match.weather, match.format.pitch, match.format.goal);
  }

  updatePossession(match);

  if (match.phase === MATCH_PHASE.PLAY) checkBallOutOfPlay(match);

  updateClock(match);
  return match;
}

function normalizeInput(raw) {
  const actions = raw.actions || {};
  return {
    moveX: clamp(raw.moveX ?? 0, -1, 1),
    moveZ: clamp(raw.moveZ ?? 0, -1, 1),
    sprint: Boolean(raw.sprint),
    shootPower: clamp(raw.shootPower ?? 0, 0, 1),
    actions: {
      pass: Boolean(actions.pass),
      through: Boolean(actions.through),
      cross: Boolean(actions.cross),
      shoot: Boolean(actions.shoot),
      tackle: Boolean(actions.tackle),
      slide: Boolean(actions.slide),
      switch: Boolean(actions.switch),
      skill: Boolean(actions.skill),
    },
  };
}

function applyHumanInput(match, player, input) {
  const a = input.actions;
  const hasBall = match.possession.id === player.id;

  if (a.switch) switchControlled(match);

  if (canAct(player)) {
    if (hasBall || ballDistance(player, match.ball) < PLAYER.reachRadius) {
      if (a.shoot) {
        if (match.ball.y > PLAYER.headerHeight.min && match.ball.y < PLAYER.headerHeight.max) doHeader(match, player);
        else doShot(match, player, input.shootPower || 0.8);
      } else if (a.cross) {
        doPass(match, player, { style: "cross", power: 1 });
      } else if (a.through) {
        doPass(match, player, { style: "through", power: 1 });
      } else if (a.pass) {
        doPass(match, player, { style: "ground", power: 0.95 });
      } else if (a.skill) {
        doSkill(match, player, match.prng.chance(0.5) ? "cut" : "stepover");
      }
    } else if (a.slide) {
      doTackle(match, player, true);
    } else if (a.tackle) {
      doTackle(match, player, false);
    }
  }

  // 自动触球：靠近球且没在做别的动作
  if (canAct(player) && canTouchBall(player, match.ball) && !hasBall) {
    if (length2(match.ball.vx, match.ball.vz) > 5.5) trapBall(match, player);
    else dribbleTouch(match, player);
  } else if (hasBall && canAct(player) && player.touchCooldown <= 0 && ballDistance(player, match.ball) < PLAYER.controlRadius) {
    dribbleTouch(match, player);
  }

  return { dirX: input.moveX, dirZ: input.moveZ, sprint: input.sprint };
}

export function switchControlled(match) {
  const ball = match.ball;
  const candidates = match.players.filter((p) => p.side === match.controlledSide && p.id !== match.controlledId && p.state !== PSTATE.FALL);
  if (!candidates.length) return;
  candidates.sort((a, b) => ballDistance(a, ball) - ballDistance(b, ball));
  match.controlledId = candidates[0].id;
  match.pushEvent({ type: "switch", playerId: match.controlledId });
}

function celebrateMotion(match, player) {
  const scorer = match.lastGoal?.playerId;
  if (player.id === scorer) {
    if (player.state !== PSTATE.CELEBRATE) setState(player, PSTATE.CELEBRATE, 2.6);
    const dir = attackDirOf(player.side);
    return { dirX: dir * 0.7, dirZ: 0.25, sprint: false };
  }
  if (match.lastGoal && player.side === match.lastGoal.side) {
    const target = match.players.find((p) => p.id === scorer);
    if (target) return moveTo(match, player, target.x, target.z, false);
  }
  return { dirX: 0, dirZ: 0, sprint: false };
}

// 身体碰撞：不允许两人重叠，接触时有推挤和失衡
function resolveBodies(match) {
  const list = match.players;
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = PLAYER.radius * 2;
      if (d >= min || d < 1e-4) continue;
      const nx = dx / d;
      const nz = dz / d;
      const overlap = (min - d) * 0.5;
      const aWeight = a.state === PSTATE.SLIDE ? 0.15 : 1;
      const bWeight = b.state === PSTATE.SLIDE ? 0.15 : 1;
      a.x -= nx * overlap * bWeight;
      a.z -= nz * overlap * bWeight;
      b.x += nx * overlap * aWeight;
      b.z += nz * overlap * aWeight;
      if (a.side !== b.side) {
        const impact = Math.abs(a.speed - b.speed) + Math.min(a.speed, b.speed) * 0.4;
        if (impact > 6.2 && match.prng.chance(0.05)) {
          const loser = a.attr.power * a.stamina < b.attr.power * b.stamina ? a : b;
          const winner = loser === a ? b : a;
          knockDown(loser, (loser.x - winner.x) / Math.max(0.1, d), (loser.z - winner.z) / Math.max(0.1, d), 0.8);
        }
      }
    }
  }
}

function resolveDive(match, keeper) {
  const ball = match.ball;
  if (match.keeperHold > 0 || keeper.touchCooldown > 0) return;
  if (ballDistance(keeper, ball) < PLAYER.reachRadius + 0.55 && ball.y < 2.4) {
    if (match.prng.chance(0.55 + keeper.attr.guts * 0.35)) {
      goalkeeperCatch(match, keeper);
    } else {
      // 扑到但没抱住 —— 脱手
      const dir = attackDirOf(keeper.side);
      ball.vx = dir * (4 + match.prng.next() * 4);
      ball.vz = match.prng.signed(5);
      ball.vy = 1.4;
      ball.lastTouchId = keeper.id;
      ball.lastTouchSide = keeper.side;
      match.pushEvent({ type: "parry", side: keeper.side, playerId: keeper.id });
    }
  }
}

function updatePossession(match) {
  const ball = match.ball;
  if (match.possession.id >= 0) {
    const carrier = match.players.find((p) => p.id === match.possession.id);
    if (!carrier || ballDistance(carrier, ball) > PLAYER.controlRadius + 1.1) {
      match.possession = { id: -1, side: match.possession.side, since: match.time };
    }
    return;
  }
  let best = null;
  let bestD = PLAYER.controlRadius + 0.35;
  for (const player of match.players) {
    if (player.state === PSTATE.FALL) continue;
    const d = ballDistance(player, ball);
    if (d < bestD) {
      bestD = d;
      best = player;
    }
  }
  if (best && ball.y < 1.1) match.possession = { id: best.id, side: best.side, since: match.time };
  else if (ball.lastTouchSide) match.possession = { id: -1, side: ball.lastTouchSide, since: match.possession.since };
}

function checkBallOutOfPlay(match) {
  const ball = match.ball;
  const halfL = match.format.pitch.length / 2;
  const halfW = match.format.pitch.width / 2;
  const halfGoal = match.format.goal.width / 2;
  const lastSide = ball.lastTouchSide || (match.possession.side || "home");
  const other = lastSide === "home" ? "away" : "home";

  // 进球
  if (Math.abs(ball.x) > halfL + BALL.radius * 0.5 && Math.abs(ball.z) < halfGoal && ball.y < match.format.goal.height) {
    const scoringSide = ball.x > 0 ? "home" : "away";
    registerGoal(match, scoringSide);
    return;
  }

  if (Math.abs(ball.z) > halfW + BALL.radius) {
    startSetPiece(match, MATCH_PHASE.THROW_IN, {
      side: other,
      x: clamp(ball.x, -halfL + 1, halfL - 1),
      z: Math.sign(ball.z) * (halfW - 0.25),
    });
    match.pushEvent({ type: "out", kind: "throw-in", side: other });
    return;
  }

  if (Math.abs(ball.x) > halfL + BALL.radius) {
    const defendingSide = ball.x > 0 ? "away" : "home"; // 该端球门属于谁
    if (lastSide === defendingSide) {
      startSetPiece(match, MATCH_PHASE.CORNER, {
        side: other,
        x: Math.sign(ball.x) * (halfL - 0.4),
        z: Math.sign(ball.z || 1) * (halfW - 0.4),
      });
      match.pushEvent({ type: "out", kind: "corner", side: other });
    } else {
      startSetPiece(match, MATCH_PHASE.GOAL_KICK, {
        side: defendingSide,
        x: Math.sign(ball.x) * (halfL - 4.2),
        z: 0,
      });
      match.pushEvent({ type: "out", kind: "goal-kick", side: defendingSide });
    }
  }
}

function registerGoal(match, side) {
  match.score[side] += 1;
  const scorerId = match.ball.lastTouchSide === side ? match.ball.lastTouchId : -1;
  const scorer = match.players.find((p) => p.id === scorerId);
  if (scorer) scorer.stats.goals += 1;
  match.lastGoal = {
    side,
    playerId: scorer ? scorer.id : -1,
    name: scorer ? scorer.name : "",
    number: scorer ? scorer.number : 0,
    time: match.time,
    ownGoal: scorer ? scorer.side !== side : false,
  };
  match.phase = MATCH_PHASE.GOAL;
  match.phaseTimer = 3.4;
  match.pushEvent({ type: "goal", side, playerId: scorer ? scorer.id : -1 });
}

function handlePhaseTransitions(match, input) {
  if (match.phase === MATCH_PHASE.PLAY || match.finished) return;
  if (match.phaseTimer > 0) return;

  switch (match.phase) {
    case MATCH_PHASE.KICKOFF: {
      match.phase = MATCH_PHASE.PLAY;
      const taker = match.players.find((p) => p.side === match.kickoffSide && p.index === match.format.perSide - 1);
      if (taker) {
        const mate = pickPassTarget(match, taker, { forward: false }) || null;
        doPass(match, taker, { style: "ground", target: mate, power: 0.8 });
      }
      match.pushEvent({ type: "whistle", kind: "kickoff" });
      break;
    }
    case MATCH_PHASE.GOAL: {
      const conceding = match.lastGoal.side === "home" ? "away" : "home";
      resetForKickoff(match, conceding);
      break;
    }
    case MATCH_PHASE.HALF_TIME: {
      match.half = 2;
      match.time = match.halfSeconds;
      resetForKickoff(match, "away");
      match.pushEvent({ type: "whistle", kind: "second-half" });
      break;
    }
    case MATCH_PHASE.THROW_IN:
    case MATCH_PHASE.GOAL_KICK:
    case MATCH_PHASE.CORNER:
    case MATCH_PHASE.FREE_KICK:
    case MATCH_PHASE.PENALTY: {
      takeSetPiece(match);
      break;
    }
    default:
      break;
  }
}

function takeSetPiece(match) {
  const spot = match.setPiece;
  match.phase = MATCH_PHASE.PLAY;
  if (!spot) return;
  const taker = match.players.find((p) => p.id === spot.takerId);
  match.setPiece = null;
  if (!taker) return;
  if (spot.phase === MATCH_PHASE.PENALTY) {
    doShot(match, taker, 0.85);
    return;
  }
  if (spot.phase === MATCH_PHASE.CORNER) {
    doPass(match, taker, { style: "cross", power: 1.05, target: pickPassTarget(match, taker, { forward: true, longRange: true }) });
    return;
  }
  if (spot.phase === MATCH_PHASE.GOAL_KICK) {
    doPass(match, taker, { style: "cross", power: 1, target: pickPassTarget(match, taker, { forward: true, longRange: true }) });
    return;
  }
  if (spot.phase === MATCH_PHASE.FREE_KICK) {
    const goal = goalCenterFor(match, taker.side);
    const d = Math.hypot(goal.x - taker.x, goal.z - taker.z);
    if (d < 24) doShot(match, taker, 0.95);
    else doPass(match, taker, { style: "through", power: 1 });
    return;
  }
  doPass(match, taker, { style: "ground", power: 0.8 });
}

function updateClock(match) {
  if (match.phase !== MATCH_PHASE.PLAY) return;
  if (match.half === 1 && match.time >= match.halfSeconds) {
    match.phase = MATCH_PHASE.HALF_TIME;
    match.phaseTimer = 3;
    match.pushEvent({ type: "whistle", kind: "half-time" });
    return;
  }
  if (match.half === 2 && match.time >= match.halfSeconds * 2) {
    match.phase = MATCH_PHASE.FULL_TIME;
    match.finished = true;
    match.pushEvent({ type: "whistle", kind: "full-time" });
  }
}

export function matchSnapshot(match) {
  return {
    tick: match.tick,
    time: match.time,
    half: match.half,
    phase: match.phase,
    score: { ...match.score },
    ball: { x: match.ball.x, y: match.ball.y, z: match.ball.z, roll: match.ball.roll },
    controlledId: match.controlledId,
    possession: { ...match.possession },
    players: match.players.map((p) => ({
      id: p.id,
      side: p.side,
      x: p.x,
      z: p.z,
      facing: p.facing,
      state: p.state,
      speed: p.speed,
      stamina: p.stamina,
      phase: p.anim.legPhase,
    })),
  };
}

export function possessionPercent(match) {
  const total = match.possessionTicks.home + match.possessionTicks.away;
  if (!total) return { home: 50, away: 50 };
  const home = Math.round((match.possessionTicks.home / total) * 100);
  return { home, away: 100 - home };
}

export { MATCH_PHASE, DIFFICULTY, FORMATS, PSTATE, dist2 };
