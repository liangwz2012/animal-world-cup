import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SoundBank } = require("../src/audio/sound-bank.js");

const created = [];
const wx = {
  createInnerAudioContext() {
    const audio = {
      playCount: 0,
      pauseCount: 0,
      stopCount: 0,
      destroyCount: 0,
      play() { this.playCount += 1; },
      pause() { this.pauseCount += 1; },
      stop() { this.stopCount += 1; },
      destroy() { this.destroyCount += 1; },
      onEnded(handler) { this.ended = handler; },
      onError(handler) { this.failed = handler; },
    };
    created.push(audio);
    return audio;
  },
};

const sound = new SoundBank(wx);
sound.startMatchAmbience();
assert.equal(created.length, 2);
assert.equal(sound.loops.music.playCount, 1);
assert.equal(sound.loops.crowd.playCount, 1);

const kick = sound.play("kick_1");
assert.ok(kick);
assert.equal(sound.pauseMatchAmbience(), true);
assert.equal(sound.pauseMatchAmbience(), false, "重复暂停必须幂等");
assert.equal(sound.loops.music.pauseCount, 1);
assert.equal(sound.loops.crowd.pauseCount, 1);
assert.equal(kick.stopCount, 1, "暂停时正在播放的单次音效必须停止");
assert.equal(sound.play("shot"), null, "暂停期间不得新播比赛音效");

assert.equal(sound.resumeMatchAmbience(), true);
assert.equal(sound.resumeMatchAmbience(), false, "重复继续必须幂等");
assert.equal(sound.loops.music.playCount, 2, "背景音乐必须从原上下文继续");
assert.equal(sound.loops.crowd.playCount, 2, "人群环境声必须同步继续");

sound.setMuted(true);
assert.equal(sound.loops.music, undefined);
sound.pauseMatchAmbience();
sound.resumeMatchAmbience();
assert.equal(sound.muted, true, "继续比赛不得解除用户静音");

sound.stopMatchAmbience();
assert.equal(sound.ambienceActive, false);
assert.equal(sound.paused, false);

console.info("[test-sound-bank] PASS：背景音乐、人群声、单次音效、静音与幂等暂停继续正常");
