import test from "node:test";
import assert from "node:assert/strict";

import { createPose, evaluatePlayerPose } from "../src/art/animation.js";
import { BONE_INDEX, BONE_NAMES, buildRestPose, measurementsOf } from "../src/art/humanoid.js";
import { PSTATE, TICK_DT } from "../src/core/constants.js";
import { createPlayer, setState, stepMotion, strideLengthOf } from "../src/core/player.js";
import { BODY_ARCHETYPES } from "../src/content/people.js";
import { FORMATS, WEATHER } from "../src/core/constants.js";

const CONTEXT = { breathT: 1.2, ballSide: 0.4, ballHigh: false, maxSpeed: 7 };

function demoPlayer(overrides = {}) {
  const player = createPlayer({ id: 1, side: "home", index: 1, role: "M", number: 7, name: "测试", pace: 0.6, power: 0.6, control: 0.6, stamina: 0.6, guts: 0.6 });
  Object.assign(player, overrides);
  return player;
}

test("所有动作状态都能求出有限的姿态数值", () => {
  const pose = createPose();
  for (const state of Object.values(PSTATE)) {
    const player = demoPlayer({ speed: state === PSTATE.SPRINT ? 7 : 3 });
    setState(player, state);
    for (const t of [0, 0.15, 0.4, 0.75, 1]) {
      player.stateT = (player.lockTotal || 0.4) * t;
      evaluatePlayerPose(pose, player, CONTEXT);
      for (let i = 0; i < pose.rot.length; i += 1) {
        assert.ok(Number.isFinite(pose.rot[i]), `${state} 的骨骼 ${BONE_NAMES[Math.floor(i / 3)]} 出现非法值`);
        assert.ok(Math.abs(pose.rot[i]) < 4, `${state} 的骨骼 ${BONE_NAMES[Math.floor(i / 3)]} 旋转过大：${pose.rot[i]}`);
      }
      for (const key of ["rootY", "pitch", "roll", "yaw"]) {
        assert.ok(Number.isFinite(pose[key]), `${state} 的 ${key} 非法`);
      }
      assert.ok(pose.rootY > -1.2 && pose.rootY < 1.2, `${state} 的重心偏移过大：${pose.rootY}`);
    }
  }
});

// 约定：knee.x 为正 = 屈膝（脚跟往臀部收）。出现负值就是反关节，小腿会往前折。
test("跑动时膝盖只会向后弯（不会反关节）", () => {
  const pose = createPose();
  const player = demoPlayer({ speed: 5.5 });
  setState(player, PSTATE.RUN, 0);
  for (let i = 0; i < 40; i += 1) {
    player.anim.legPhase = i / 40;
    evaluatePlayerPose(pose, player, CONTEXT);
    for (const bone of ["kneeL", "kneeR"]) {
      const value = pose.rot[BONE_INDEX[bone] * 3];
      assert.ok(value >= -0.06, `${bone} 出现反关节：${value.toFixed(3)}`);
    }
  }
});

test("步频由速度反推，脚不打滑", () => {
  const format = FORMATS["5v5"];
  const player = demoPlayer();
  const results = [];
  for (const [label, throttle, sprint] of [["慢跑", 0.45, false], ["快跑", 1, false], ["冲刺", 1, true]]) {
    player.x = 0;
    player.z = 0;
    player.vx = 0;
    player.vz = 0;
    player.stamina = 1;
    player.anim.legPhase = 0;
    // 先跑 2 秒让速度稳定，再开始统计
    for (let i = 0; i < 60; i += 1) stepMotion(player, { dirX: 0, dirZ: throttle, sprint }, TICK_DT, WEATHER.clear, format);
    let cycles = 0;
    let distance = 0;
    let last = player.anim.legPhase;
    const strides = [];
    for (let i = 0; i < 240; i += 1) {
      stepMotion(player, { dirX: 0, dirZ: throttle, sprint }, TICK_DT, WEATHER.clear, format);
      distance += player.speed * TICK_DT;
      strides.push(strideLengthOf(player));
      if (player.anim.legPhase < last) cycles += 1;
      last = player.anim.legPhase;
    }
    assert.ok(cycles >= 2, `${label} 没有完成足够的步态循环`);
    const stride = strides.reduce((a, b) => a + b, 0) / strides.length;
    results.push({ label, strideDistance: distance / cycles, stride, speed: player.speed });
  }
  assert.ok(results.length === 3);
  assert.ok(results[2].speed > results[0].speed + 1.5, "冲刺应当明显快于慢跑");
  for (const row of results) {
    // 一个完整循环 = 左右各一步 = 两倍步幅。误差超过 6% 就意味着脚在地上滑。
    const expected = row.stride * 2;
    const error = Math.abs(row.strideDistance - expected) / expected;
    assert.ok(error < 0.06, `${row.label}（${row.speed.toFixed(2)} m/s）步频与位移不匹配：循环位移 ${row.strideDistance.toFixed(3)}，应为 ${expected.toFixed(3)}`);
  }
});

test("出脚动作有蓄力—触球—随挥三段（大腿先后摆再前摆）", () => {
  const pose = createPose();
  const player = demoPlayer({ speed: 2 });
  setState(player, PSTATE.SHOOT);
  player.anim.kickLeg = 1;
  const samples = [];
  for (const t of [0.15, 0.35, 0.55, 0.9]) {
    player.stateT = player.lockTotal * t;
    evaluatePlayerPose(pose, player, CONTEXT);
    samples.push(pose.rot[BONE_INDEX.hipR * 3]);
  }
  assert.ok(samples[0] < samples[1], "蓄力阶段大腿应后摆（hip 转正）");
  assert.ok(samples[2] < samples[1], "触球阶段大腿应快速前摆（hip 转负）");
  assert.ok(samples[2] < -0.5, `触球时摆腿幅度不足：${samples[2].toFixed(2)}`);
});

test("滑铲与倒地会把身体放倒并降低重心", () => {
  const pose = createPose();
  for (const state of [PSTATE.SLIDE, PSTATE.FALL, PSTATE.DIVE]) {
    const player = demoPlayer({ speed: 5 });
    setState(player, state);
    player.stateT = player.lockTotal * 0.5;
    evaluatePlayerPose(pose, player, CONTEXT);
    const laid = Math.abs(pose.pitch) > 0.4 || Math.abs(pose.roll) > 0.4;
    assert.ok(laid, `${state} 应当有明显的躯干倾倒`);
    assert.ok(pose.rootY < -0.05 || state === PSTATE.DIVE, `${state} 应当降低重心`);
  }
});

test("骨架长度随身材参数变化，且比例合理", () => {
  for (const [id, body] of Object.entries(BODY_ARCHETYPES)) {
    const m = measurementsOf(body);
    const rest = buildRestPose(m);
    assert.equal(rest.length, BONE_NAMES.length, `${id} 的骨骼数量不对`);
    // 髋高应当在身高的 45%~55% 之间
    const ratio = m.hipY / body.height;
    assert.ok(ratio > 0.44 && ratio < 0.57, `${id} 的腿身比异常：${ratio.toFixed(3)}`);
    // 皮克斯式风格化比例：头高约为身高的 1/6，比写实的 1/7.4 明显大一档
    const headHeight = m.headRadius * 2.17;
    const headRatio = body.height / headHeight;
    assert.ok(headRatio > 5.4 && headRatio < 6.8, `${id} 的头身比不在皮克斯区间：${headRatio.toFixed(2)}`);
    assert.ok(m.shoulderHalf * 2 > m.headRadius * 2, `${id} 的肩比头还窄`);
  }
  const tall = measurementsOf(BODY_ARCHETYPES["tall-youth"]);
  const short = measurementsOf(BODY_ARCHETYPES["compact-strong"]);
  assert.ok(tall.thigh > short.thigh, "高个的大腿应更长");
  assert.ok(measurementsOf(BODY_ARCHETYPES["stocky-butcher"]).rHip > measurementsOf(BODY_ARCHETYPES["lean-farmhand"]).rHip, "壮实体型腰围应更大");
});

test("任何动作下膝盖都不会反关节", () => {
  const pose = createPose();
  for (const state of Object.values(PSTATE)) {
    const player = demoPlayer({ speed: 4 });
    setState(player, state);
    for (let i = 0; i <= 12; i += 1) {
      player.stateT = (player.lockTotal || 0.4) * (i / 12);
      player.anim.legPhase = i / 12;
      evaluatePlayerPose(pose, player, CONTEXT);
      for (const bone of ["kneeL", "kneeR"]) {
        const value = pose.rot[BONE_INDEX[bone] * 3];
        assert.ok(value >= -0.08, `${state} 的 ${bone} 反关节：${value.toFixed(3)}`);
      }
    }
  }
});

test("射门时摆动脚会甩到身体前方（脚不会往后踢）", () => {
  const pose = createPose();
  const player = demoPlayer({ speed: 2 });
  setState(player, PSTATE.SHOOT);
  player.anim.kickLeg = 1;
  // 用骨骼角度粗算脚踝相对髋的前后位置：屈髋(负)把腿带向 +Z，屈膝(正)把小腿收回 -Z
  const footZ = (t) => {
    player.stateT = player.lockTotal * t;
    evaluatePlayerPose(pose, player, CONTEXT);
    const hip = pose.rot[BONE_INDEX.hipR * 3];
    const knee = pose.rot[BONE_INDEX.kneeR * 3];
    return -Math.sin(hip) * 0.45 - Math.sin(hip + knee) * 0.42;
  };
  const windupZ = footZ(0.28);
  const strikeZ = footZ(0.55);
  assert.ok(windupZ < 0, `蓄力时脚应在身后：${windupZ.toFixed(3)}`);
  assert.ok(strikeZ > 0.25, `触球时脚应甩到身前：${strikeZ.toFixed(3)}`);
  assert.ok(strikeZ - windupZ > 0.5, "蓄力到触球的位移不足");
});
