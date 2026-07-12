import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFriendInputSampler } = require("../src/net/friend-input-sampler.js");

const sampler = createFriendInputSampler();
const source = { active: true, vx: 2, vy: 2, pass: true, tackle: true, shoot: true, sprint: true };
const first = sampler.sample(source);
assert.equal(first.frame, 1);
assert.ok(Math.hypot(first.input.vx, first.input.vy) <= 1.000001);
assert.equal(first.input.pass, true);
assert.equal(first.input.tackle, true);
assert.equal(first.input.pulseSeq.pass, 1);
assert.equal(first.input.pulseSeq.tackle, 1);
assert.equal(first.input.shoot, true, "射门是持续按住动作");
assert.equal(source.pass, false, "单次传球必须在网络采样后消费");
assert.equal(source.tackle, false, "单次铲球必须在网络采样后消费");

const second = sampler.sample(source);
assert.equal(second.input.pass, false);
assert.equal(second.input.tackle, false);
assert.deepEqual(second.input.pulseSeq, {});
source.pass = true;
assert.equal(sampler.sample(source).input.pulseSeq.pass, 2);

const neutral = sampler.neutral();
assert.equal(neutral.input.active, false);
assert.equal(neutral.input.vx, 0);
sampler.reset();
assert.equal(sampler.frame, 0);

console.info("[test:friend-input-sampler] PASS：30 Hz 输入归一化、单次动作序号和断线归零正常");
