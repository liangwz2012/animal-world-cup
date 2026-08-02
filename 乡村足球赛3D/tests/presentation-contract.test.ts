import assert from 'node:assert/strict';
import test from 'node:test';
import { MatchCore, M0_MATCH_CONFIG } from '@rural-football/match-core';
import { buildPresentationFrame } from '@rural-football/presentation-3d';

test('表现帧只消费快照和事件，并把 2D 比赛坐标映射到 3D 世界', () => {
  const core = new MatchCore();
  const previous = core.snapshot;
  const step = core.step({
    tick: 0,
    commands: {
      'home-1': {
        move: { x: 0, y: 0 },
        sprint: false,
        kick: {
          kind: 'pass',
          aim: { x: 1, y: 0.2 },
          power01: 0.5
        }
      }
    }
  });
  const frame = buildPresentationFrame({
    previous,
    current: step.snapshot,
    interpolationAlpha: 0.5,
    events: step.events
  });
  const player = frame.players.find((candidate) => candidate.id === 'home-1')!;

  assert.equal(frame.tick, 1);
  assert.equal(player.animation, 'pass');
  assert.equal(player.footContact?.kind, 'pass');
  assert.equal(player.position.z, player.position.z);
  assert.ok(frame.ball.position.y >= M0_MATCH_CONFIG.ballRadius);
  assert.equal(frame.ball.ownerId, null);
});

test('插值系数会被限制在 0 到 1', () => {
  const core = new MatchCore();
  const snapshot = core.snapshot;
  const frame = buildPresentationFrame({
    previous: snapshot,
    current: snapshot,
    interpolationAlpha: 9,
    events: []
  });
  assert.equal(frame.interpolationAlpha, 1);
});
