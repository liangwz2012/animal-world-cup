import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReplay } from '@rural-football/match-core';
import type {
  InputFrame,
  MatchEvent,
  PlayerCommand,
  Replay
} from '@rural-football/match-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'tests', 'fixtures');
const evidence = path.join(root, 'tests', 'evidence');

function command(moveX: number, moveY: number, sprint = false): PlayerCommand {
  return { move: { x: moveX, y: moveY }, sprint };
}

const frames: InputFrame[] = [];
for (let tick = 0; tick < 240; tick += 1) {
  const home = tick < 45
    ? command(1, 0.08, true)
    : command(tick < 120 ? 0.4 : -0.2, tick < 120 ? 0.6 : -0.1);
  if (tick === 45) {
    home.kick = {
      kind: 'pass',
      aim: { x: 0.9, y: 0.35 },
      power01: 0.72
    };
  }
  frames.push({
    tick,
    commands: {
      'home-1': home,
      'home-2': command(0.45, -0.15, tick % 50 < 20),
      'away-1': command(-0.55, tick % 80 < 40 ? 0.1 : -0.1)
    }
  });
}

const replay: Replay = {
  version: 1,
  seed: 0x5eed2026,
  frames
};
const result = runReplay(replay);
const eventCounts = result.events.reduce<Record<string, number>>((counts, event: MatchEvent) => {
  counts[event.type] = (counts[event.type] ?? 0) + 1;
  return counts;
}, {});

await mkdir(fixtures, { recursive: true });
await mkdir(evidence, { recursive: true });
await writeFile(
  path.join(fixtures, 'm0-replay.json'),
  JSON.stringify(replay, null, 2) + '\n'
);
await writeFile(
  path.join(evidence, 'm0-replay-baseline.json'),
  JSON.stringify({
    schemaVersion: 1,
    generatedFor: 'M0',
    replay: 'tests/fixtures/m0-replay.json',
    seed: replay.seed,
    ticks: replay.frames.length,
    checksum: result.checksum,
    eventCounts
  }, null, 2) + '\n'
);

console.log(
  'M0 回放已生成：' + replay.frames.length +
  ' ticks，checksum=' + result.checksum
);
