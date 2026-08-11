// 球永远是独立模拟的刚体：任何时候都不会被挂到脚上或用位移插值假装控球。
// 控球 = 每一次触球给一个冲量，球自己滚。这是"手感真实"的第一条硬规则。

import { BALL } from "./constants.js";
import { clamp, length2 } from "./mathx.js";

export function createBall() {
  return {
    x: 0,
    y: BALL.radius,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    spin: 0, // 绕竖直轴的旋转，决定弧线
    roll: 0, // 视觉滚动累计角，渲染层用
    rollAxisX: 1,
    rollAxisZ: 0,
    lastTouchId: -1,
    lastTouchSide: "",
    lastTouchTime: 0,
    outOfPlay: false,
  };
}

export function resetBall(ball, x, z) {
  ball.x = x;
  ball.y = BALL.radius;
  ball.z = z;
  ball.vx = 0;
  ball.vy = 0;
  ball.vz = 0;
  ball.spin = 0;
  ball.outOfPlay = false;
}

export function ballSpeed(ball) {
  return length2(ball.vx, ball.vz);
}

export function kickBall(ball, { vx, vy, vz, spin = 0, playerId = -1, side = "", time = 0 }) {
  ball.vx = vx;
  ball.vy = vy;
  ball.vz = vz;
  ball.spin = spin;
  ball.lastTouchId = playerId;
  ball.lastTouchSide = side;
  ball.lastTouchTime = time;
  if (ball.y < BALL.radius) ball.y = BALL.radius;
}

// 单步积分。goalPosts 用于门柱/横梁碰撞，pitch 用于地面。
export function stepBall(ball, dt, weather, pitch, goal) {
  const rollFactor = weather?.rollFactor ?? 1;
  const windX = weather?.windX ?? 0;
  const windZ = weather?.windZ ?? 0;

  const airborne = ball.y > BALL.radius + 1e-3;
  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy + ball.vz * ball.vz);

  if (airborne) {
    // 空气阻力 + 马格努斯力（只做水平弧线，足够读出"香蕉球"）
    const drag = BALL.airDrag * speed * dt;
    ball.vx -= (ball.vx - windX) * drag * 0.06;
    ball.vy -= ball.vy * drag * 0.06;
    ball.vz -= (ball.vz - windZ) * drag * 0.06;
    ball.vx += -ball.vz * ball.spin * BALL.magnus * dt * 30;
    ball.vz += ball.vx * ball.spin * BALL.magnus * dt * 30;
    ball.vy -= BALL.gravity * dt;
  } else {
    // 地面滚动：阻尼与天气有关，雨后泥地更"黏"
    const decay = Math.exp(-((1 - BALL.rollDrag) * 12 * rollFactor) * dt);
    ball.vx *= decay;
    ball.vz *= decay;
    ball.vx += -ball.vz * ball.spin * BALL.magnus * dt * 8;
    ball.vz += ball.vx * ball.spin * BALL.magnus * dt * 8;
    if (length2(ball.vx, ball.vz) < BALL.restSpeed) {
      ball.vx = 0;
      ball.vz = 0;
    }
  }

  ball.spin *= Math.exp(-BALL.spinDecay * dt);

  const prevX = ball.x;
  const prevZ = ball.z;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;

  // 地面
  if (ball.y <= BALL.radius) {
    ball.y = BALL.radius;
    if (ball.vy < -0.4) {
      ball.vy = -ball.vy * BALL.bounce;
      ball.vx *= 0.9;
      ball.vz *= 0.9;
    } else {
      ball.vy = 0;
    }
  }

  // 门柱与横梁
  if (goal) hitGoalFrame(ball, goal, pitch, prevX, prevZ);

  // 滚动视觉
  const horizSpeed = length2(ball.vx, ball.vz);
  if (horizSpeed > 0.01) {
    ball.roll += (horizSpeed * dt) / BALL.radius;
    ball.rollAxisX = -ball.vz / horizSpeed;
    ball.rollAxisZ = ball.vx / horizSpeed;
  }
  return ball;
}

function hitGoalFrame(ball, goal, pitch, prevX, prevZ) {
  const halfLen = pitch.length / 2;
  const halfGoal = goal.width / 2;
  for (const sign of [-1, 1]) {
    const lineX = sign * halfLen;
    const crossed = (prevX - lineX) * (ball.x - lineX) <= 0;
    if (!crossed) continue;
    // 横梁
    if (Math.abs(ball.z) < halfGoal && Math.abs(ball.y - goal.height) < BALL.radius + 0.06) {
      ball.y = goal.height - BALL.radius - 0.02;
      ball.vy = -Math.abs(ball.vy) * 0.5;
      ball.vx *= -0.35;
      ball.frameHit = true;
    }
    // 门柱
    if (ball.y < goal.height && Math.abs(Math.abs(ball.z) - halfGoal) < BALL.radius + 0.06) {
      ball.z = Math.sign(ball.z) * (halfGoal + (Math.abs(ball.z) > halfGoal ? 1 : -1) * (BALL.radius + 0.07));
      ball.vz *= -0.6;
      ball.vx *= -0.45;
      ball.frameHit = true;
    }
  }
}

// 预测球在 t 秒后的落点，AI 与门将用它决定跑位
export function predictBall(ball, t, weather) {
  const rollFactor = weather?.rollFactor ?? 1;
  let x = ball.x;
  let z = ball.z;
  let y = ball.y;
  let vx = ball.vx;
  let vy = ball.vy;
  let vz = ball.vz;
  const dt = 1 / 15;
  for (let elapsed = 0; elapsed < t; elapsed += dt) {
    if (y > BALL.radius + 1e-3) {
      vy -= BALL.gravity * dt;
    } else {
      const decay = Math.exp(-((1 - BALL.rollDrag) * 12 * rollFactor) * dt);
      vx *= decay;
      vz *= decay;
      vy = 0;
    }
    x += vx * dt;
    y = Math.max(BALL.radius, y + vy * dt);
    z += vz * dt;
  }
  return { x, y, z, vx, vy, vz };
}

// 给定起点与目标点，解出把球送到目标所需的初速度（低平球/半高球/吊球）
export function solveKick(from, to, style = "ground", power = 1) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = clamp(length2(dx, dz), 0.5, 90);
  const dirX = dx / dist;
  const dirZ = dz / dist;
  if (style === "lob" || style === "cross") {
    // 用抛体公式求解，角度固定 38°，射程不足时提高速度
    const angle = style === "cross" ? 0.62 : 0.72;
    const speed = Math.sqrt((dist * BALL.gravity) / Math.sin(2 * angle)) * clamp(power, 0.6, 1.3);
    return {
      vx: dirX * speed * Math.cos(angle),
      vz: dirZ * speed * Math.cos(angle),
      vy: speed * Math.sin(angle),
    };
  }
  if (style === "drive") {
    const speed = clamp(11 + dist * 0.42, 12, 27) * clamp(power, 0.5, 1.25);
    return { vx: dirX * speed, vz: dirZ * speed, vy: Math.min(2.6, dist * 0.07) };
  }
  // 地面传球：速度按距离给，保证 0.6~1.6 秒到位
  const speed = clamp(5.4 + dist * 0.78, 6, 21) * clamp(power, 0.55, 1.3);
  return { vx: dirX * speed, vz: dirZ * speed, vy: 0 };
}
