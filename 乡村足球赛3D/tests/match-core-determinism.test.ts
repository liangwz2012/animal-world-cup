import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  MatchCore,
  XorShift32,
  checksumSnapshot,
  runReplay
} from '@rural-football/match-core';
import type { Replay } from '@rural-football/match-core';

const replay = JSON.parse(
  readFileSync(new URL('./fixtures/m0-replay.json', import.meta.url), 'utf8')
) as Replay;
const baseline = JSON.parse(
  readFileSync(new URL('./evidence/m0-replay-baseline.json', import.meta.url), 'utf8')
) as { checksum: string; ticks: number };

test('相同种子与输入产生完全一致的快照和校验值', () => {
  const first = runReplay(replay);
  const second = runReplay(replay);

  assert.deepEqual(first.snapshot, second.snapshot);
  assert.equal(first.checksum, second.checksum);
  assert.equal(first.checksum, baseline.checksum);
  assert.equal(replay.frames.length, baseline.ticks);
  assert.equal(first.snapshot.tick, replay.frames.length);
  assert.ok(first.events.some((event) => event.type === 'kick'));
});

test('快照是防御性副本，外部修改不会污染比赛核心', () => {
  const core = new MatchCore({ seed: 7 });
  const snapshot = core.snapshot;
  snapshot.players[0]!.position.x = 999;
  snapshot.ball.position.x = 999;

  assert.notEqual(core.snapshot.players[0]!.position.x, 999);
  assert.notEqual(core.snapshot.ball.position.x, 999);
});

test('输入 tick 必须连续', () => {
  const core = new MatchCore();
  assert.throws(
    () => core.step({ tick: 2, commands: {} }),
    /输入 tick 不连续/
  );
});

test('XorShift32 的状态和序列可复现', () => {
  const first = new XorShift32(123456);
  const second = new XorShift32(123456);
  const sequenceA = Array.from({ length: 8 }, () => first.nextUint32());
  const sequenceB = Array.from({ length: 8 }, () => second.nextUint32());

  assert.deepEqual(sequenceA, sequenceB);
  assert.equal(checksumSnapshot(new MatchCore({ seed: 123456 }).snapshot).length, 8);
});
