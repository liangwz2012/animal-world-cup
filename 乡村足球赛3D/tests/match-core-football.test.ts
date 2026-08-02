import assert from 'node:assert/strict';
import test from 'node:test';
import { MatchCore } from '@rural-football/match-core';
import type { GoalEvent, KickEvent, MatchEvent } from '@rural-football/match-core';

test('射门会释放独立足球并产生带脚接触信息的事件', () => {
  const core = new MatchCore({ seed: 42 });
  const before = core.snapshot;
  assert.equal(before.ball.ownerId, 'home-1');

  const result = core.step({
    tick: 0,
    commands: {
      'home-1': {
        move: { x: 0, y: 0 },
        sprint: false,
        kick: {
          kind: 'shot',
          aim: { x: 1, y: 0 },
          power01: 1
        }
      }
    }
  });
  const kick = result.events.find((event): event is KickEvent => event.type === 'kick');

  assert.ok(kick);
  assert.equal(kick.foot, 'right');
  assert.equal(kick.kind, 'shot');
  assert.equal(result.snapshot.ball.ownerId, null);
  assert.ok(result.snapshot.ball.position.x > before.ball.position.x);
  assert.ok(result.snapshot.ball.height > 0);
  assert.notDeepEqual(
    result.snapshot.ball.position,
    result.snapshot.players.find((player) => player.id === 'home-1')!.position
  );
});

test('中路满力射门能够形成进球、比分和重开冻结状态', () => {
  const core = new MatchCore({ seed: 42 });
  const events: MatchEvent[] = [];

  for (let tick = 0; tick < 160; tick += 1) {
    const result = core.step({
      tick,
      commands: tick === 0
        ? {
            'home-1': {
              move: { x: 0, y: 0 },
              sprint: false,
              kick: {
                kind: 'shot',
                aim: { x: 1, y: 0 },
                power01: 1
              }
            }
          }
        : {}
    });
    events.push(...result.events);
    if (events.some((event) => event.type === 'goal')) break;
  }

  const goal = events.find((event): event is GoalEvent => event.type === 'goal');
  assert.ok(goal, '射门应在测试时限内越过球门线');
  assert.equal(goal.team, 'home');
  assert.equal(goal.scorerId, 'home-1');
  assert.deepEqual(goal.score, { home: 1, away: 0 });
  assert.equal(core.snapshot.phase, 'goal-freeze');
});

test('球员输入按固定 30Hz 推进且受场地边界约束', () => {
  const core = new MatchCore();
  for (let tick = 0; tick < 600; tick += 1) {
    core.step({
      tick,
      commands: {
        'home-1': {
          move: { x: -1, y: 1 },
          sprint: true
        }
      }
    });
  }
  const player = core.snapshot.players.find((candidate) => candidate.id === 'home-1')!;
  assert.ok(player.position.x >= -32);
  assert.ok(player.position.y <= 21);
  assert.ok(player.stamina01 >= 0 && player.stamina01 <= 1);
});
